/**
 * What season 1 needs from the harness that season 0 did not have: a pinned effort and image,
 * a pause that loses nothing, waits that outlast a closed subscription, and stops that fire
 * before a broken night fills the queue with rows. Each test is one way a wave was wasted, or
 * nearly was.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { testDb, type Db } from "@/db/client";
import { createProject } from "@/db/repo";
import { pendingRuns, planWave, savePromptSet, waveRows } from "@/db/waves";
import { importPromptSet } from "@/lib/import-prompts";
import { isFatal, runWave, servedDrift } from "@/runner/queue";
import { HarnessError, RateLimitedError, throwForOutcome, type CliResult } from "@/runner/cli-process";
import { agentArgs, resolveSandbox } from "@/runner/surfaces/agent-repo";
import { digestMatches, sandboxOf } from "@/runner/sandbox";
import { toolchainCheck } from "@/runner/preflight";
import type { ChatSurface, RunOutcome } from "@/runner/types";

let db: Db;
let waveId: number;

const fakeSurface = (run: ChatSurface["run"]): ChatSurface => ({
  key: "fake", label: () => "Fake", price: () => ({ input: 1, output: 1 }), run,
});
const ok = (): RunOutcome => ({
  text: "An answer.", stopReason: "end_turn", truncated: false,
  searchCount: 0, searchUnit: "fake.searches", searchQueries: [], sources: [],
  inputTokens: 1, outputTokens: 1, toolErrors: [],
  raw: {}, modelResolved: "fake-1", costUsd: 0, durationMs: 1,
});

beforeEach(() => {
  db = testDb();
  const projectId = createProject(db, { slug: "s", name: "S", brand: { name: "S", aliases: ["S"] } }).id;
  const setId = savePromptSet(db, projectId, importPromptSet({
    prompts: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, prompt: `prompt ${i}` })),
  })).id;
  waveId = planWave(db, {
    projectId, promptSetId: setId, name: "w",
    surfaces: [{ surfaceKey: "chat.api.anthropic", label: "Fake", modelRequested: "fake-1", reps: 2, config: {} }],
  }).id;
});

describe("effort is part of the instrument", () => {
  it("passes the pinned effort to the CLI, and nothing when none is pinned", () => {
    const pinned = agentArgs("agent.repo.claude", "Deploy.", "claude-opus-5-5", "high");
    expect(pinned.join(" ")).toMatch(/--model claude-opus-5-5 --effort high/);
    expect(agentArgs("agent.repo.claude", "Deploy.", "claude-opus-5-5")).not.toContain("--effort");
  });

  it("reads effort and digest from the wave file", () => {
    expect(sandboxOf({ sandbox: { image: "aeo-sandbox:s1", claudeVersion: "2.1.280", digest: "sha256:c5e3", effort: "high" } }))
      .toEqual({ image: "aeo-sandbox:s1", claudeVersion: "2.1.280", digest: "sha256:c5e3", effort: "high" });
  });
});

describe("the image a run gets is the image the wave pinned", () => {
  const probe = (digest: string | null, cli = "2.1.280 (Claude Code)") => ({
    digest: async () => digest, cliVersion: async () => cli,
  });

  it("refuses a sandboxed Claude surface with no effort", async () => {
    await expect(resolveSandbox("agent.repo.claude", { image: "img:a" }, probe("sha256:aaa")))
      .rejects.toBeInstanceOf(HarnessError);
  });

  it("refuses an image whose digest is not the pinned one", async () => {
    await expect(resolveSandbox("agent.repo.claude", { image: "img:b", digest: "sha256:bbb", effort: "high" }, probe("sha256:ccc")))
      .rejects.toThrow(/the wave pins sha256:bbb/);
  });

  it("refuses a tag rebuilt between two runs of the same process", async () => {
    const cfg = { image: "img:c", effort: "high" };
    const first = await resolveSandbox("agent.repo.claude", cfg, probe("sha256:111"));
    expect(first).toMatchObject({ digest: "sha256:111", effort: "high" });
    await expect(resolveSandbox("agent.repo.claude", cfg, probe("sha256:222"))).rejects.toThrow(/rebuilt during the wave/);
  });

  it("refuses an image on another CLI release", async () => {
    await expect(resolveSandbox("agent.repo.claude", { image: "img:d", claudeVersion: "2.1.280", effort: "high" }, probe("sha256:ddd", "2.1.260 (Claude Code)")))
      .rejects.toThrow(/the wave pins 2.1.280/);
  });

  it("matches a full id against a short pin, and nothing against a missing image", () => {
    expect(digestMatches("sha256:c5e3cb9cde6d", "sha256:c5e3cb9c")).toBe(true);
    expect(digestMatches("sha256:c5e3cb9cde6d", "c5e3cb9c")).toBe(true);
    expect(digestMatches("sha256:7b57dada204b", "sha256:c5e3cb9c")).toBe(false);
    expect(digestMatches(null, "sha256:c5e3cb9c")).toBe(false);
  });
});

describe("a run cut short by the machine stays owed", () => {
  const result = (stdout: string, exitCode: number | null): CliResult =>
    ({ stdout, stderr: "", exitCode, timedOut: false, durationMs: 1, outcome: exitCode === 0 ? "ok" : "error" });
  const started = '{"type":"system","subtype":"init"}\n{"type":"assistant","message":{"model":"claude-opus-5-5"}}\n';

  it("throws for a Docker restart: a half transcript and exit 125", () => {
    expect(() => throwForOutcome(result(started, 125), "claude")).toThrow(/before its closing result line/);
    expect(() => throwForOutcome(result(started, 137), "claude")).toThrow(/measured nothing/);
  });

  it("leaves a run the CLI closed itself to the extractor", () => {
    const closed = `${started}{"type":"result","subtype":"error_max_turns","is_error":true}\n`;
    expect(() => throwForOutcome(result(closed, 1), "claude")).not.toThrow();
  });
});

describe("a 401 in a transcript is not a login failure", () => {
  const err = new Error("claude got a provider error and measured nothing. request_id req_0401ab, 4017 tokens");

  it("does not stop an agent wave on it", () => {
    expect(isFatal(err, true)).toBeNull();
  });

  it("still stops on a classified login failure or a misconfigured harness", () => {
    expect(isFatal(new HarnessError("no token"), true)).toMatch(/harness misconfigured/);
  });
});

describe("pausing", () => {
  it("finishes the run in flight, stores it, and leaves the rest owed", async () => {
    let asked = 0;
    const r = await runWave(db, waveId, {
      concurrency: 1,
      resolveSurface: () => fakeSurface(async () => ok()),
      pauseRequested: () => (asked++ >= 2 ? "paused by data/PAUSE" : null),
    });
    expect(r.stoppedBecause).toBe("paused by data/PAUSE");
    expect(waveRows(db, waveId).filter((x) => x.status === "ok")).toHaveLength(1);
    expect(pendingRuns(db, waveId)).toHaveLength(9);
  });

  it("stops a limit wait as soon as a pause is asked for, with nothing stored", async () => {
    let waits = 0;
    const r = await runWave(db, waveId, {
      concurrency: 1,
      sleep: async () => { waits += 1; },
      pauseRequested: () => (waits >= 3 ? "paused by SIGINT" : null),
      resolveSurface: () => fakeSurface(async () => { throw new RateLimitedError("session limit · resets 3am"); }),
    });
    expect(r.stoppedBecause).toBe("paused by SIGINT");
    expect(waveRows(db, waveId)).toHaveLength(0);
    expect(pendingRuns(db, waveId)).toHaveLength(10);
  });
});

describe("running out of credits", () => {
  it("waits for as long as the window stays closed instead of giving up after six hours", async () => {
    let calls = 0;
    const r = await runWave(db, waveId, {
      concurrency: 1,
      sleep: async () => {},
      limit: 1,
      resolveSurface: () => fakeSurface(async () => {
        calls += 1;
        if (calls <= 40) throw new RateLimitedError("usage limit");
        return ok();
      }),
    });
    expect(r.stoppedBecause).toBeUndefined();
    expect(r.rateLimited).toBe(40);
    expect(r.ok).toBe(1);
  });
});

describe("a broken night", () => {
  it("pauses after three errors in a row, every one still owed", async () => {
    const r = await runWave(db, waveId, {
      concurrency: 1,
      resolveSurface: () => fakeSurface(async () => { throw new Error("connect ECONNREFUSED docker.sock"); }),
    });
    expect(r.errored).toBe(3);
    expect(r.stoppedBecause).toMatch(/3 errors in a row/);
    expect(pendingRuns(db, waveId)).toHaveLength(10);
  });

  it("does not count errors separated by a stored run as a streak", async () => {
    let n = 0;
    const r = await runWave(db, waveId, {
      concurrency: 1,
      resolveSurface: () => fakeSurface(async () => { n += 1; if (n % 3 === 0) return ok(); throw new Error("flaky"); }),
    });
    expect(r.stoppedBecause).toBeUndefined();
    expect(r.attempted).toBe(10);
  });
});

describe("model drift", () => {
  it("is a longer model name, not a dated snapshot of the same one", () => {
    const job = { surfaceKey: "agent.repo.claude", model: "claude-opus-5" };
    expect(servedDrift(job, { modelResolved: "claude-opus-5-5" })).toMatch(/served claude-opus-5-5/);
    expect(servedDrift(job, { modelResolved: "claude-opus-5-20260901" })).toBeNull();
    expect(servedDrift(job, { modelResolved: "claude-opus-5" })).toBeNull();
    expect(servedDrift({ surfaceKey: "chat.api.anthropic", model: "x" }, { modelResolved: "y" })).toBeNull();
  });
});

describe("the toolchains a run needs", () => {
  const report = (python: string, pythonpath = "/opt/python/bin/python3") =>
    `python ${python}\npythonpath ${pythonpath}\nnode v22.23.2\ngo go1.23.4\ndotnet 8.0.420\nuv 0.12.10`;

  it("passes season 0's image", () => {
    expect(toolchainCheck(report("3.13.15")).status).toBe("pass");
  });

  it("fails the image wave 3 restarted on: Debian's 3.11 first on PATH", () => {
    const c = toolchainCheck(report("3.11.2", "/usr/bin/python3"));
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/linkding needs >=3.13/);
  });
});

describe("effort reaches the published record", () => {
  it("counts the effort runs were given, with null for a run that passed none", async () => {
    const { agentBenchmark } = await import("@/derive/agent-benchmark");
    const { datasetRun } = await import("@/derive/dataset");
    const { row } = await import("./fixtures/agent-rows");
    const sb = { image: "aeo-sandbox:s1", digest: "sha256:c5e3", cliVersion: "2.1.280 (Claude Code)" };
    const rows = [
      row({ sandbox: { ...sb, effort: "high" } }),
      row({ sandbox: { ...sb, effort: "high" } }),
      row({ sandbox: { ...sb } }),
    ];
    const b = agentBenchmark(rows, [{ name: "Render", aliases: ["Render"] }]);
    expect(b.provenance.efforts).toEqual([{ effort: "high", runs: 2 }, { effort: null, runs: 1 }]);
    expect(datasetRun(rows[0]).sandbox?.effort).toBe("high");
    expect(datasetRun(rows[2]).sandbox?.effort).toBeNull();
  });
});

describe("an interval does not depend on row order", () => {
  it("gives the same interval for the same rows read in reverse", async () => {
    const { adoptionIntervals } = await import("@/derive/agent-benchmark");
    const { row } = await import("./fixtures/agent-rows");
    // Uneven clusters, so a resample that followed row order would land differently.
    const rows = ["a", "b", "c", "d", "e"].flatMap((t, i) => Array.from({ length: i + 1 }, (_, k) =>
      row({ target: t, adopted: (i * k) % 3 === 0 ? "Render" : "Fly.io" })));
    const forward = adoptionIntervals(rows, ["Render"]).get("Render");
    const backward = adoptionIntervals([...rows].reverse(), ["Render"]).get("Render");
    expect(backward).toEqual(forward);
  });
});
