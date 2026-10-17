import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb, type Db } from "@/db/client";
import { createProject } from "@/db/repo";
import { pendingRuns, planWave, savePromptSet, getWave, waveRows } from "@/db/waves";
import { importPromptSet } from "@/lib/import-prompts";
import { runWave } from "@/runner/queue";
import { AuthFailedError, HarnessError, RateLimitedError } from "@/runner/cli-process";
import type { ChatSurface, RunOutcome } from "@/runner/types";

let db: Db;
let waveId: number;

/** A surface that never touches the network, so the queue's own logic is what is tested. */
const fakeSurface = (run: ChatSurface["run"]): ChatSurface => ({
  key: "fake", label: () => "Fake", price: () => ({ input: 1, output: 1 }), run,
});

const ok = (costUsd = 0.01): RunOutcome => ({
  text: "An answer.", stopReason: "end_turn", truncated: false,
  searchCount: 1, searchUnit: "fake.searches", searchQueries: [], sources: [],
  inputTokens: 10, outputTokens: 10, toolErrors: [],
  raw: {}, modelResolved: "fake-1", costUsd, durationMs: 5,
});

beforeEach(() => {
  db = testDb();
  const projectId = createProject(db, { slug: "a", name: "A", brand: { name: "A", aliases: ["A"] } }).id;
  const setId = savePromptSet(db, projectId, importPromptSet({
    prompts: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, prompt: `prompt ${i}` })),
  })).id;
  waveId = planWave(db, {
    projectId, promptSetId: setId, name: "w", costCapUsd: 0.05,
    // A real key with an injected adapter: this suite exercises the queue, not the registry,
    // but a wave may not be planned against a surface the app could never run.
    surfaces: [{ surfaceKey: "chat.api.anthropic", label: "Fake", modelRequested: "fake-1", reps: 2, config: {} }],
  }).id;
});

describe("runWave", () => {
  it("runs every pending cell and marks the wave complete", async () => {
    const r = await runWave(db, waveId, {
      resolveSurface: () => fakeSurface(async () => ok(0.001)), concurrency: 3,
    });
    expect(r.attempted).toBe(10);
    expect(r.ok).toBe(10);
    expect(pendingRuns(db, waveId)).toHaveLength(0);
    expect(getWave(db, waveId)!.status).toBe("complete");
  });

  // A cap that only reports the overspend afterwards is not a cap.
  it("stops at the cost cap mid-wave and leaves the rest pending", async () => {
    const r = await runWave(db, waveId, {
      resolveSurface: () => fakeSurface(async () => ok(0.02)), concurrency: 1,
    });
    expect(r.stoppedBecause).toMatch(/cost cap reached/);
    expect(r.attempted).toBeLessThan(10);
    expect(pendingRuns(db, waveId).length).toBeGreaterThan(0);
    expect(getWave(db, waveId)!.status).toBe("paused");
  });

  /**
   * Bad credentials fail every remaining run in milliseconds. Continuing would fill the
   * table with errors that look like results and burn the whole plan in a few seconds.
   */
  it("aborts the whole wave on an authentication failure rather than burning every cell", async () => {
    const run = vi.fn(async () => { throw new Error("401 authentication_error: invalid x-api-key"); });
    const r = await runWave(db, waveId, { resolveSurface: () => fakeSurface(run), concurrency: 1 });
    expect(r.stoppedBecause).toMatch(/authentication failed/);
    expect(run).toHaveBeenCalledTimes(1);
    // Nothing was measured, so nothing is stored and every cell is still owed. Logging
    // in and re-running picks the whole wave up untouched.
    expect(r.errored).toBe(0);
    expect(waveRows(db, waveId)).toHaveLength(0);
    expect(pendingRuns(db, waveId)).toHaveLength(10);
  });

  it("recognises the CLI surfaces' typed auth error too", async () => {
    const run = vi.fn(async () => { throw new AuthFailedError("claude is not logged in"); });
    const r = await runWave(db, waveId, { resolveSurface: () => fakeSurface(run), concurrency: 1 });
    expect(r.stoppedBecause).toMatch(/authentication failed/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  /**
   * A subscription window closing is a "come back later", not an answer. The original
   * harness slept twenty minutes and asked the same cell again, up to eight times, and
   * that is what let it survive closed laptops and exhausted weekly windows without
   * losing a completed run.
   */
  describe("usage limits", () => {
    it("waits and retries the same cell, storing nothing in between", async () => {
      let attempt = 0;
      const slept: number[] = [];
      const r = await runWave(db, waveId, {
        limit: 1, concurrency: 1,
        sleep: async (ms) => { slept.push(ms); },
        limitSleepMs: 1200,
        resolveSurface: () => fakeSurface(async () => {
          attempt += 1;
          if (attempt <= 2) throw new RateLimitedError("usage limit reached");
          return ok(0.001);
        }),
      });
      expect(attempt).toBe(3);
      expect(slept).toEqual([1200, 1200]);
      expect(r.rateLimited).toBe(2);
      expect(r.ok).toBe(1);
      // Two limited attempts, one stored run — the limit left no trace in the data.
      expect(waveRows(db, waveId)).toHaveLength(1);
    });

    it("gives up cleanly after the window is exhausted, leaving the cell owed", async () => {
      const r = await runWave(db, waveId, {
        concurrency: 1,
        sleep: async () => {},
        maxLimitedAttempts: 3,
        resolveSurface: () => fakeSurface(async () => { throw new RateLimitedError("429 too many requests"); }),
      });
      expect(r.stoppedBecause).toMatch(/usage limit window exhausted/);
      expect(r.stoppedBecause).toMatch(/nothing was lost/);
      expect(waveRows(db, waveId)).toHaveLength(0);
      expect(pendingRuns(db, waveId)).toHaveLength(10);
      expect(getWave(db, waveId)!.status).toBe("paused");
    });

    it("resets the streak after a run succeeds, so scattered limits do not add up", async () => {
      let n = 0;
      const r = await runWave(db, waveId, {
        concurrency: 1,
        sleep: async () => {},
        maxLimitedAttempts: 2,
        resolveSurface: () => fakeSurface(async () => {
          n += 1;
          // A limit before every other run: never two in a row, so never exhausting.
          if (n % 3 === 1) throw new RateLimitedError("rate limit");
          return ok(0.001);
        }),
      });
      expect(r.stoppedBecause).toBeUndefined();
      expect(r.ok).toBe(10);
    });
  });

  it("keeps going after an ordinary error and records it as a row", async () => {
    let n = 0;
    const r = await runWave(db, waveId, {
      concurrency: 1,
      resolveSurface: () => fakeSurface(async () => {
        n += 1;
        if (n === 2) throw new Error("upstream timed out");
        return ok(0.001);
      }),
    });
    expect(r.errored).toBe(1);
    expect(r.ok).toBe(9);
    expect(waveRows(db, waveId).filter((x) => x.status === "error")).toHaveLength(1);
  });

  it("counts a truncated run as voided, not as an answer", async () => {
    const r = await runWave(db, waveId, {
      limit: 2,
      resolveSurface: () => fakeSurface(async () => ({ ...ok(0.001), truncated: true, stopReason: "max_tokens", text: "" })),
    });
    expect(r.voided).toBe(2);
    expect(r.ok).toBe(0);
  });

  // Re-invoking is the resume: work already stored is never paid for twice.
  it("resumes without repeating stored runs", async () => {
    await runWave(db, waveId, { limit: 4, resolveSurface: () => fakeSurface(async () => ok(0.001)) });
    const second = await runWave(db, waveId, { resolveSurface: () => fakeSurface(async () => ok(0.001)) });
    expect(second.attempted).toBe(6);
    expect(waveRows(db, waveId)).toHaveLength(10);
  });

  it("does nothing, cheaply, when the wave is already finished", async () => {
    await runWave(db, waveId, { resolveSurface: () => fakeSurface(async () => ok(0.001)) });
    const run = vi.fn(async () => ok(0.001));
    const again = await runWave(db, waveId, { resolveSurface: () => fakeSurface(run) });
    expect(again.attempted).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });
});

/**
 * The property an unattended overnight wave depends on: however many times the process
 * dies and is restarted, the stored runs end up as exactly the planned set — every cell
 * once, none twice, none missing.
 *
 * The runbook tells a person to re-run the same command after a crash, a closed laptop or
 * an exhausted rate window. That instruction is only safe if this holds, so it is checked
 * rather than asserted in a comment.
 */
describe("crash and resume", () => {
  const storedKeys = () =>
    waveRows(db, waveId)
      .filter((r) => r.status !== "error")
      .map((r) => `${r.cellId}:${r.rep}`);

  const plannedKeys = () => {
    // Read before anything runs: what the wave owes in total.
    const seen = new Set<string>();
    for (const p of pendingRuns(db, waveId)) seen.add(`${p.cellId}:${p.rep}`);
    return seen;
  };

  it("lands exactly the planned set across repeated hard failures", async () => {
    const owed = plannedKeys();
    expect(owed.size).toBe(10);

    // A surface that dies partway through, the way a killed process or a crashed CLI does.
    let calls = 0;
    const flaky = (dieAfter: number) => fakeSurface(async () => {
      calls += 1;
      if (calls > dieAfter) throw new Error("process died");
      return ok(0.001);
    });

    // Three interrupted attempts, then one that completes.
    for (const dieAfter of [3, 2, 2]) {
      calls = 0;
      await runWave(db, waveId, { resolveSurface: () => flaky(dieAfter), concurrency: 1 });
    }
    calls = 0;
    await runWave(db, waveId, { resolveSurface: () => fakeSurface(async () => ok(0.001)), concurrency: 1 });

    const stored = storedKeys();
    // No cell was measured twice — a duplicate would silently weight that prompt.
    expect(new Set(stored).size).toBe(stored.length);
    // And nothing was skipped, which is the failure that quietly unbalances a wave.
    expect(new Set(stored)).toEqual(owed);
  });

  /**
   * A cell that failed must stay owed. If an error row satisfied the debt, one transient
   * fault would permanently unbalance the wave and no re-run could ever close it.
   */
  it("keeps a failed cell owed rather than counting it as done", async () => {
    let first = true;
    await runWave(db, waveId, {
      limit: 1,
      resolveSurface: () => fakeSurface(async () => {
        if (first) { first = false; throw new Error("transient"); }
        return ok(0.001);
      }),
      concurrency: 1,
    });
    expect(pendingRuns(db, waveId)).toHaveLength(10);

    await runWave(db, waveId, { resolveSurface: () => fakeSurface(async () => ok(0.001)), concurrency: 1 });
    expect(pendingRuns(db, waveId)).toHaveLength(0);
    expect(storedKeys()).toHaveLength(10);
  });

  /**
   * A rate limit is a "come back later", not a measurement: the window closes the run
   * without storing anything, and the morning re-run picks the same cell back up.
   */
  it("resumes cleanly after a usage window is exhausted", async () => {
    const limited = await runWave(db, waveId, {
      resolveSurface: () => fakeSurface(async () => { throw new RateLimitedError("usage limit"); }),
      sleep: async () => {}, maxLimitedAttempts: 2, concurrency: 1,
    });
    expect(limited.stoppedBecause).toBeDefined();
    expect(storedKeys()).toHaveLength(0);
    expect(pendingRuns(db, waveId)).toHaveLength(10);

    await runWave(db, waveId, { resolveSurface: () => fakeSurface(async () => ok(0.001)), concurrency: 1 });
    const stored = storedKeys();
    expect(stored).toHaveLength(10);
    expect(new Set(stored).size).toBe(10);
  });
});

/**
 * An agent cell is a prompt *and* a repository. The queue used to resolve every key through
 * the chat registry, so a planned, preflighted agent wave failed its first cell with
 * "unknown surface" — after the design had been committed to and the night started.
 */
describe("agent surfaces", () => {
  let agentWaveId: number;
  const agentOutcome = (): RunOutcome => ({
    ...ok(0),
    // An agent run names the model it was served; the wave asks for this one.
    modelResolved: "claude-opus-5",
    raw: { changedFiles: ["render.yaml"], adoption: { adopted: "Render" } },
  });

  beforeEach(() => {
    const projectId = createProject(db, { slug: "b", name: "B", brand: { name: "B", aliases: ["B"] } }).id;
    const setId = savePromptSet(db, projectId, importPromptSet({
      prompts: [{ id: "deploy", prompt: "Deploy this repository." }],
    })).id;
    agentWaveId = planWave(db, {
      projectId, promptSetId: setId, name: "agents",
      surfaces: [{
        surfaceKey: "agent.repo.claude", label: "Claude Code (in-repo)", modelRequested: "claude-opus-5",
        reps: 1, config: { timeoutMs: 1000 },
        targets: [
          { id: "go", url: "https://example.test/go", sha: "abc123" },
          { id: "django", url: "https://example.test/django" },
          { id: "orphan" },
        ],
      }],
    }).id;
  });

  it("hands each cell its repository, its pin and the prompt", async () => {
    const calls: { key: string; url: string; prompt: string; sha?: string; model: string }[] = [];
    const r = await runWave(db, agentWaveId, {
      concurrency: 1,
      resolveSurface: () => { throw new Error("an agent cell must not be routed to the chat registry"); },
      runAgent: async (key, url, prompt, cfg) => {
        calls.push({ key, url, prompt, sha: cfg.sha, model: cfg.model });
        return agentOutcome();
      },
    });
    expect(calls.map((c) => c.url).sort()).toEqual(["https://example.test/django", "https://example.test/go"]);
    expect(calls.every((c) => c.key === "agent.repo.claude" && c.prompt === "Deploy this repository." && c.model === "claude-opus-5")).toBe(true);
    expect(calls.find((c) => c.url.endsWith("/go"))!.sha).toBe("abc123");
    expect(calls.find((c) => c.url.endsWith("/django"))!.sha).toBeUndefined();
    expect(r.ok).toBe(2);
  });

  it("records a cell whose target has no url as an error, and keeps the wave going", async () => {
    const r = await runWave(db, agentWaveId, {
      concurrency: 1,
      runAgent: async () => agentOutcome(),
    });
    expect(r.ok).toBe(2);
    expect(r.errored).toBe(1);
    const failed = waveRows(db, agentWaveId).filter((x) => x.status === "error");
    expect(failed).toHaveLength(1);
    expect(failed[0].target).toBe("orphan");
    expect(failed[0].error).toMatch(/has no url/);
    // Still owed: fixing the design and re-planning is the way out, not silently skipping it.
    expect(pendingRuns(db, agentWaveId)).toHaveLength(1);
  });

  it("stores what the agent surface returned, raw record included", async () => {
    await runWave(db, agentWaveId, { concurrency: 1, runAgent: async () => agentOutcome() });
    const stored = waveRows(db, agentWaveId).filter((x) => x.status === "ok");
    expect(stored).toHaveLength(2);
    // The chat rows are graded on text; these carry the changed-file list the ladder reads.
    expect(stored.every((x) => x.surfaceKey === "agent.repo.claude")).toBe(true);
  });
});

describe("a cell that fails twice", () => {
  /**
   * `(cell, rep)` is unique, so recording a second failure for the same repeat used to
   * throw — and the throw escaped the worker and ended the wave. A cell failing twice
   * across resume attempts is ordinary, not exotic: one repeatedly flaky repository was
   * enough to end an unattended night at 2am, hours before anyone looked.
   */
  it("is recorded again without killing the wave", async () => {
    const failing = fakeSurface(async () => { throw new Error("transient"); });
    // The error-streak pause is lifted: this is about the second record, not the stop.
    const a = await runWave(db, waveId, { resolveSurface: () => failing, concurrency: 1, maxErrorStreak: Infinity });
    const b = await runWave(db, waveId, { resolveSurface: () => failing, concurrency: 1, maxErrorStreak: Infinity });

    expect(a.errored).toBe(10);
    expect(b.errored).toBe(10);
    // Still owed, and still exactly one error row per repeat rather than a duplicate.
    expect(pendingRuns(db, waveId)).toHaveLength(10);
    expect(waveRows(db, waveId).filter((r) => r.status === "error")).toHaveLength(10);
  });

  /** A later failure must never overwrite a measurement that already succeeded. */
  it("does not overwrite a real answer with a subsequent error", async () => {
    await runWave(db, waveId, { resolveSurface: () => fakeSurface(async () => ok(0.001)), concurrency: 1 });
    const before = waveRows(db, waveId).filter((r) => r.status !== "error").length;

    await runWave(db, waveId, {
      resolveSurface: () => fakeSurface(async () => { throw new Error("late failure"); }),
      concurrency: 1,
    });
    expect(waveRows(db, waveId).filter((r) => r.status !== "error")).toHaveLength(before);
  });
});

/**
 * A CLI the harness cannot drive on this machine is the auth failure's twin: nothing was
 * measured, every cell would fail the same way, and the fix is a person's. The first live
 * agent cell hit this as a root refusal and was stored as a voided run instead.
 */
describe("a harness the CLI refuses", () => {
  it("stops the wave and stores nothing, leaving every cell owed", async () => {
    const run = vi.fn(async () => { throw new HarnessError("claude refused to run under this harness"); });
    const r = await runWave(db, waveId, { resolveSurface: () => fakeSurface(run), concurrency: 1 });
    expect(r.stoppedBecause).toMatch(/harness misconfigured/);
    expect(run).toHaveBeenCalledTimes(1);
    expect(r.errored).toBe(0);
    expect(waveRows(db, waveId)).toHaveLength(0);
    expect(pendingRuns(db, waveId)).toHaveLength(10);
  });
});

/**
 * A run that cannot say which machine made it is a run that can be passed off as a
 * measurement. Two cells in the original agent wave chose Railway because a token was on
 * the laptop; the preflight can see that before a wave, but it is advisory and this
 * command never calls it, so the verdict has to end up on the row.
 */
describe("provenance", () => {
  const dirty = { account: "dev@laptop", clean: false, issues: ["credentials on disk"] };

  it("stamps the account and its verdict onto every run", async () => {
    await runWave(db, waveId, {
      env: dirty, resolveSurface: () => fakeSurface(async () => ok(0.001)), concurrency: 1,
    });
    const rows = waveRows(db, waveId);
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.account).toBe("dev@laptop");
      expect(r.envClean).toBe(false);
      expect(r.envIssues).toEqual(["credentials on disk"]);
    }
  });

  it("records a clean account as clean, with no issues", async () => {
    await runWave(db, waveId, {
      env: { account: "bench@mac", clean: true, issues: [] },
      resolveSurface: () => fakeSurface(async () => ok(0.001)), concurrency: 1,
    });
    const row = waveRows(db, waveId)[0];
    expect(row.account).toBe("bench@mac");
    expect(row.envClean).toBe(true);
    expect(row.envIssues).toEqual([]);
  });

  /**
   * Null rather than true: a run stored without a stamp — an import, or a row written
   * before this column existed — has no claim to make about the machine that made it, and
   * a default of "clean" would launder exactly the rows whose provenance is unknown.
   */
  it("leaves the verdict null when nothing stamped the run", async () => {
    const { recordRun } = await import("@/db/waves");
    const p = pendingRuns(db, waveId)[0];
    recordRun(db, p.cellId, p.rep, ok(0.001));
    const row = waveRows(db, waveId)[0];
    expect(row.account).toBeNull();
    expect(row.envClean).toBeNull();
    expect(row.envIssues).toBeNull();
  });
});

/**
 * The reason a subscription wave runs one cell at a time was written in `run-wave.mts`, so
 * the browser's Run button — the other caller — passed `concurrency: 4` and would have run
 * four agent cells at once against the same Max account. The default now lives with the
 * surface registry and is applied by the queue, so a caller that says nothing gets it right.
 */
describe("concurrency", () => {
  it("runs one at a time when every owed surface is a subscription", async () => {
    const { defaultConcurrency } = await import("@/runner/surfaces");
    expect(defaultConcurrency(["chat.cli.claude"])).toBe(1);
    expect(defaultConcurrency(["agent.repo.claude", "chat.cli.codex"])).toBe(1);
  });

  it("parallelises when anything in the wave is billed per call", async () => {
    const { defaultConcurrency } = await import("@/runner/surfaces");
    expect(defaultConcurrency(["chat.api.anthropic"])).toBe(4);
    expect(defaultConcurrency(["agent.repo.claude", "chat.api.openai"])).toBe(4);
  });

  it("never exceeds one in flight on a subscription wave, with no concurrency given", async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = fakeSurface(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return ok(0.001);
    });
    const projectId = createProject(db, { slug: "b", name: "B", brand: { name: "B", aliases: ["B"] } }).id;
    const setId = savePromptSet(db, projectId, importPromptSet({
      prompts: Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, prompt: `q ${i}` })),
    })).id;
    const cliWave = planWave(db, {
      projectId, promptSetId: setId, name: "cli",
      surfaces: [{ surfaceKey: "chat.cli.claude", label: "CLI", modelRequested: "m", reps: 2, config: {} }],
    }).id;
    await runWave(db, cliWave, { resolveSurface: () => slow, env: { account: "t@t", clean: true, issues: [] } });
    expect(peak).toBe(1);
  });
});
