import { describe, expect, it } from "vitest";
import { agentBenchmark } from "@/derive/agent-benchmark";
import { agentClaims } from "@/derive/agent-claims";
import { verifyClaims } from "@/derive/claims";
import { DATASET_SCHEMA, datasetRun, waveDataset, type WaveDataset } from "@/derive/dataset";
import { pilot, platforms, row } from "./fixtures/agent-rows";

const meta = {
  wave: { id: 3, name: "pilot", startedAt: 1_788_499_000, finishedAt: 1_788_510_000 },
  waveFile: "waves/hosting-s0.json",
  graderVersion: "stance-3",
  generatedAt: "2026-09-10T08:00:00.000Z",
  platforms,
};

const build = (rows = pilot()): WaveDataset => waveDataset(agentBenchmark(rows, platforms), rows, meta);

describe("waveDataset", () => {
  it("carries every run, each with its frame and its repository, and the prompt text once", () => {
    const rows = pilot();
    const d = build(rows);
    expect(d.runs).toHaveLength(rows.length);
    expect(new Set(d.runs.map((r) => r.runId)).size).toBe(rows.length);
    for (const r of d.runs) {
      expect(r.frame).toBeTruthy();
      expect(r.repository.id).toBeTruthy();
      expect(d.prompts[r.promptKey]).toBeDefined();
      expect(d.prompts[r.promptKey].frame).toBe(r.frame);
      expect(r).not.toHaveProperty("promptText");
    }
    expect(d.prompts.cost.text).toBe("cheaply, please");
    expect(d.design.repositories.map((r) => r.id)).toEqual(["whoami", "healthchecks"]);
    expect(d.design.planned).toBe(2 * 2 * 2);
  });

  it("takes a sandbox credential and a stranger's address out of the closing message", () => {
    const text = "Deployed. Log in as `admin` / `k3Xq-2f8Lp`. Git had no identity, so I authored it "
      + "as `matt ferrante <mferrante3@gmail.com>` — amend if you'd prefer otherwise.";
    const d = build([row({ text })]);
    expect(d.runs[0].closingMessage).not.toContain("k3Xq-2f8Lp");
    expect(d.runs[0].closingMessage).not.toContain("mferrante3");
    expect(d.runs[0].closingMessage).not.toContain("ferrante");
    expect(d.runs[0].closingMessage).toContain("gmail.com");
    expect(d.redacted.closingMessages).toBe(1);
    expect(d.redacted.rule).toMatch(/domains kept/);
  });

  it("reports zero redactions when a wave had nothing to take out", () => {
    expect(build().redacted.closingMessages).toBe(0);
  });

  it("keeps the closing message in full and the transcript out", () => {
    const long = "I chose Render. ".repeat(500);
    const d = build([row({ text: long, toolTimeline: [{ seq: 1, tool: "Bash", detail: "npm test" }], toolErrors: ["x"] })]);
    expect(d.runs[0].closingMessage).toBe(long);
    expect(d.runs[0].toolTimeline).toBe(1);
    expect(d.runs[0].toolErrors).toBe(1);
    const text = JSON.stringify(d);
    expect(text).not.toContain("npm test");
    expect(text).not.toContain('"stdout"');
  });

  it("stamps the sandbox, the review and the times in a form a reader can act on", () => {
    const rows = pilot();
    rows[0].reviewedAt = 1_788_600_000;
    rows[0].reviewNote = "relabelled by hand";
    rows[1].sandbox = null;
    const d = build(rows);
    expect(d.runs[0]).toMatchObject({
      sandbox: { image: "aeo-sandbox:s0", digest: "sha256:2a368b0692e48f3b9a6adfd8bbfe1b2861d873ccb989b32f97ec99a3466896b4" },
      cliVersion: "2.1.260", reviewedAt: "2026-09-05T09:20:00.000Z", reviewNote: "relabelled by hand",
      ranAt: "2026-09-04T05:33:20.000Z",
    });
    expect(d.runs[1].sandbox).toBeNull();
    expect(d.provenance.images).toEqual(["aeo-sandbox:s0@2a368b0692e4"]);
    expect(d.wave).toEqual({
      id: 3, name: "pilot", file: "waves/hosting-s0.json",
      startedAt: "2026-09-04T05:16:40.000Z", finishedAt: "2026-09-04T08:20:00.000Z",
    });
    expect(d.provenance.firstRunAt).toBe("2026-09-04T05:33:20.000Z");
  });

  it("carries the adoption table with intervals, the frame cut, the flip rate and the claims", () => {
    const d = build();
    const render = d.adoption.find((a) => a.platform === "Render")!;
    expect(render.adopted).toBe(3);
    expect(render.ci).not.toBeNull();
    expect(d.byFrame.map((f) => f.frame)).toEqual(["cost", "open"]);
    expect(d.stability).toMatchObject({ comparable: 3, flipped: 2 });
    expect(d.claims).toEqual(agentClaims(agentBenchmark(pilot(), platforms), 3));
    expect(verifyClaims(d.claims)).toEqual([]);
    expect(d.totals).toMatchObject({ runs: 8, gradeable: 7, voided: 1, undecided: 1 });
  });

  it("round-trips through JSON with a stable key order", () => {
    const rows = pilot();
    const a = JSON.stringify(build(rows), null, 2);
    const back = JSON.parse(a) as WaveDataset;
    expect(back.schema).toBe(DATASET_SCHEMA);
    expect(JSON.stringify(back, null, 2)).toBe(a);
    // Two builds of the same rows are byte-identical, so a committed file diffs as nothing.
    expect(JSON.stringify(build(rows), null, 2)).toBe(a);
    expect(Object.keys(back)).toEqual([
      "schema", "generatedAt", "graderVersion", "redacted", "wave", "surface", "design", "prompts", "platforms", "provenance",
      "totals", "adoption", "byFrame", "stability", "claims", "runs",
    ]);
    expect(Object.keys(back.runs[0])).toEqual(Object.keys(datasetRun(pilot()[0])));
  });

  /**
   * `named` is a count of alias matches. A record without the aliases cannot reproduce it,
   * which is how a reload of season 0 came to read Cloudflare named 20 against a true 50.
   */
  it("publishes the alias lists and domains every named count was computed with", () => {
    const d = build();
    expect(d.platforms).toEqual([
      { name: "Fly.io", aliases: ["Fly.io", "Fly"], domains: ["fly.io"], caseSensitive: false },
      { name: "Railway", aliases: ["Railway"], domains: ["railway.com", "railway.app"], caseSensitive: false },
      { name: "Render", aliases: ["Render"], domains: ["render.com"], caseSensitive: false },
    ]);
  });

  it("orders runs by cell then repeat whatever order the rows arrive in", () => {
    const rows = pilot().reverse();
    const d = build(rows);
    const order = d.runs.map((r) => [r.cellId, r.rep]);
    expect(order).toEqual([...order].sort((x, y) => x[0] - y[0] || x[1] - y[1]));
  });
});
