import { describe, expect, it } from "vitest";
import { canonical, reconcile } from "@/derive/reconcile";

const vocab = ["Fly.io", "Render", "Self-managed VM"];
const read = (runId: number, winner: string | null) => ({ runId, winner, note: `read ${runId}` });

describe("reconcile", () => {
  const full = { source: "full", covers: [1, 2, 3], readings: [read(1, "Render"), read(2, "Fly.io"), read(3, null)] };
  const heuristic = { source: "heuristic", covers: [1, 2, 3], readings: [read(1, "Render"), read(2, "Render"), read(3, null)] };

  it("keeps a run every reading agrees on, with the reader's note rather than the heuristic's", () => {
    const r = reconcile([1, 2, 3], [heuristic, full], vocab);
    expect(r.unanimous.map((u) => u.runId)).toEqual([1, 3]);
    expect(r.unanimous[0].note).toMatch(/^Unanimous across 2 readings\. read 1$/);
    expect(r.unanimous[1].winner).toBeNull();
  });

  it("sends a split to a verdict instead of counting votes", () => {
    const r = reconcile([1, 2, 3], [heuristic, full, { source: "r2", covers: [2], readings: [read(2, "Render")] }], vocab);
    // Two say Render, one says Fly.io: still a split, because one of the two is the regex.
    expect(r.splits.map((s) => s.runId)).toEqual([2]);
    expect(() => canonical(r, [])).toThrow(/no verdict written for split run\(s\) 2/);
    const c = canonical(r, [{ runId: 2, winner: "Fly.io", note: "fly.toml is the one provider config" }]);
    expect(c.map((x) => x.winner)).toEqual(["Render", "Fly.io", null]);
  });

  it("reports a run a full reading skipped, and a name outside the vocabulary", () => {
    const r = reconcile([1, 2, 3], [{ source: "full", covers: [1, 2, 3], readings: [read(1, "Render"), read(2, "Fly")] }], vocab);
    expect(r.missing).toEqual([{ source: "full", runId: 3 }]);
    expect(r.unknownNames).toEqual([{ source: "full", runId: 2, winner: "Fly" }]);
  });
});
