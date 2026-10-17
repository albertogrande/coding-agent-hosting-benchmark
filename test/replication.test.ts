import { describe, expect, it } from "vitest";
import { cellAgreement, majorityOf, NONE, replicationClaim } from "@/derive/replication";
import { verifyClaims } from "@/derive/claims";
import { row } from "./fixtures/agent-rows";
import type { AgentRow } from "@/derive/agent-benchmark";

/** One cell: three repeats on one repository under one frame, committing to the given values. */
const cell = (target: string, frame: string, adopted: (string | null)[], cellId = 1): AgentRow[] =>
  adopted.map((a, i) => row({ cellId, rep: i + 1, target, frame, promptKey: frame, adopted: a, changedFiles: a ? ["x"] : [] }));

describe("majorityOf", () => {
  it("is the value two or more gradeable repeats hold, with no platform as a value of its own", () => {
    expect(majorityOf(cell("a", "cost", ["Render", "Render", "Fly.io"]))).toBe("Render");
    expect(majorityOf(cell("a", "open", [null, null, "Fly.io"]))).toBe(NONE);
    expect(majorityOf(cell("a", "cost", ["Render", "Fly.io", "Railway"]))).toBeNull();
    expect(majorityOf(cell("a", "cost", ["Render", "Fly.io", null]))).toBeNull();
  });

  it("ignores a voided repeat: two agreeing gradeable repeats are a majority, one is not", () => {
    const reps = cell("a", "cost", ["Render", "Render", "Render"]);
    reps[2].reach = "voided";
    expect(majorityOf(reps)).toBe("Render");
    reps[1].reach = "voided";
    expect(majorityOf(reps)).toBeNull();
  });
});

describe("cellAgreement", () => {
  const waveA = [
    ...cell("whoami", "cost", ["Render", "Render", "Fly.io"], 1),
    ...cell("whoami", "open", [null, null, "Fly.io"], 2),
    ...cell("hc", "cost", ["Railway", "Railway", "Railway"], 3),
    ...cell("hc", "open", ["Render", "Fly.io", "Railway"], 4),
    ...cell("only-a", "cost", ["Render", "Render", "Render"], 5),
  ];
  const waveB = [
    ...cell("whoami", "cost", ["Render", "Fly.io", "Render"], 11),
    ...cell("whoami", "open", [null, "Fly.io", null], 12),
    ...cell("hc", "cost", ["Fly.io", "Fly.io", "Railway"], 13),
    ...cell("hc", "open", ["Render", "Render", "Railway"], 14),
    ...cell("only-b", "open", ["Render", "Render", "Render"], 15),
  ];

  it("compares cells on their majority, counts none as a value, and lists every disagreement with both sides", () => {
    const a = cellAgreement(waveA, waveB);
    expect(a.comparable).toBe(3);
    expect(a.agreeing).toBe(2);
    expect(a.rate).toBeCloseTo(2 / 3);
    expect(a.disagreements).toEqual([{ target: "hc", frame: "cost", a: "Railway", b: "Fly.io" }]);
  });

  it("does not compare a cell with no majority on either side, and says so", () => {
    const a = cellAgreement(waveA, waveB);
    expect(a.noMajority).toEqual([{ target: "hc", frame: "open", a: null, b: "Render" }]);
    expect(a.unmatched).toBe(2);
  });

  it("counts the runs that committed to nothing per frame in each wave", () => {
    expect(cellAgreement(waveA, waveB).noneByFrame).toEqual([
      { frame: "cost", a: 0, b: 0 },
      { frame: "open", a: 2, b: 2 },
    ]);
  });

  it("is symmetric in what it compares and empty when the waves share no cell", () => {
    const ab = cellAgreement(waveA, waveB);
    const ba = cellAgreement(waveB, waveA);
    expect(ba.comparable).toBe(ab.comparable);
    expect(ba.agreeing).toBe(ab.agreeing);
    expect(ba.disagreements).toEqual([{ target: "hc", frame: "cost", a: "Fly.io", b: "Railway" }]);
    const none = cellAgreement(waveA, cell("elsewhere", "cost", ["Render", "Render", "Render"]));
    expect(none).toMatchObject({ comparable: 0, agreeing: 0, rate: null, disagreements: [] });
    expect(replicationClaim(none, 3, 2)).toBeNull();
  });

  it("registers the rate as a claim that verifies, resting on the compared cells", () => {
    const claim = replicationClaim(cellAgreement(waveA, waveB), 3, 2)!;
    expect(claim).toMatchObject({ id: "replication-wave-2", value: 67, support: 3 });
    expect(claim.derivation).toMatch(/2 of 3 repository × frame cells/);
    expect(claim.derivation).toMatch(/1 cell\(s\) with no majority/);
    expect(verifyClaims([claim])).toEqual([]);
  });
});
