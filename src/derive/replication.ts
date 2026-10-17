/**
 * Replication between two agent waves: did the same cell reach the same answer on another
 * night, on another instrument?
 *
 * Compared on the cell's majority, not on any single repeat: a cell that went Render,
 * Render, Fly is a Render cell, and one repeat disagreeing inside a wave is the flip rate's
 * business, not this figure's. A cell with no value held by two repeats has no majority, and
 * a cell with no majority on either side is not compared — a measurement that could not be
 * taken is reported as such, never as a disagreement. "No platform" is a value like any
 * other: a cell that committed to nothing both nights agrees.
 *
 * Pure over rows; nothing here reads a store.
 */
import { isGradeable, type AgentRow } from "./agent-benchmark";
import type { Claim } from "./claims";

/** The majority value of a cell that committed to nothing. */
export const NONE = "none";

/** The number of repeats a value must be held by to be the cell's majority. */
export const MAJORITY = 2;

export type CellPair = { target: string; frame: string; a: string | null; b: string | null };

export type CellAgreement = {
  /** Cells present in both waves with a majority in both. */
  comparable: number;
  agreeing: number;
  rate: number | null;
  disagreements: { target: string; frame: string; a: string; b: string }[];
  /** Cells present in both waves where at least one side had no majority. Not compared. */
  noMajority: CellPair[];
  /** Cells run in one wave and not the other. */
  unmatched: number;
  /** Gradeable runs that committed to nothing, per frame, in each wave. */
  noneByFrame: { frame: string; a: number; b: number }[];
};

/** The value at least `MAJORITY` gradeable repeats hold, or null. Null adoption counts as `NONE`. */
export function majorityOf(reps: AgentRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of reps.filter(isGradeable)) {
    const v = r.adopted ?? NONE;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const held = [...counts].filter(([, n]) => n >= MAJORITY).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  return held.length ? held[0][0] : null;
}

const cellKey = (r: AgentRow) => `${r.target} ${r.frame}`;

const group = (rows: AgentRow[]) => {
  const m = new Map<string, AgentRow[]>();
  for (const r of rows) {
    const k = cellKey(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
};

export function cellAgreement(rowsA: AgentRow[], rowsB: AgentRow[]): CellAgreement {
  const ga = group(rowsA);
  const gb = group(rowsB);
  const disagreements: CellAgreement["disagreements"] = [];
  const noMajority: CellPair[] = [];
  let comparable = 0, agreeing = 0, unmatched = 0;

  for (const [key, reps] of ga) {
    const other = gb.get(key);
    if (!other) { unmatched += 1; continue; }
    const a = majorityOf(reps);
    const b = majorityOf(other);
    const { target, frame } = reps[0];
    if (a === null || b === null) { noMajority.push({ target, frame, a, b }); continue; }
    comparable += 1;
    if (a === b) agreeing += 1;
    else disagreements.push({ target, frame, a, b });
  }
  for (const key of gb.keys()) if (!ga.has(key)) unmatched += 1;

  const frames = [...new Set([...rowsA.map((r) => r.frame), ...rowsB.map((r) => r.frame)])];
  const none = (rows: AgentRow[], frame: string) => rows.filter((r) => r.frame === frame && isGradeable(r) && !r.adopted).length;

  return {
    comparable,
    agreeing,
    rate: comparable ? agreeing / comparable : null,
    disagreements: disagreements.sort((x, y) => x.target.localeCompare(y.target) || x.frame.localeCompare(y.frame)),
    noMajority: noMajority.sort((x, y) => x.target.localeCompare(y.target) || x.frame.localeCompare(y.frame)),
    unmatched,
    noneByFrame: frames.map((frame) => ({ frame, a: none(rowsA, frame), b: none(rowsB, frame) })),
  };
}

/** The agreement figure as a claim, so the page carries it with its derivation and its rows. */
export function replicationClaim(agreement: CellAgreement, waveId: number, againstWaveId: number): Claim | null {
  if (!agreement.comparable) return null;
  return {
    id: `replication-wave-${againstWaveId}`,
    label: `cell majorities agreeing with wave ${againstWaveId}`,
    value: Math.round((agreement.rate ?? 0) * 100),
    derivation:
      `${agreement.agreeing} of ${agreement.comparable} repository × frame cells whose majority value ` +
      `(held by ${MAJORITY}+ gradeable repeats; "none" when nothing was adopted) is the same in wave ${waveId} and wave ${againstWaveId}` +
      (agreement.noMajority.length ? `; ${agreement.noMajority.length} cell(s) with no majority on one side not compared` : ""),
    support: agreement.comparable,
  };
}
