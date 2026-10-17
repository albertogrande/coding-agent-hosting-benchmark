/**
 * Several readings of one wave, merged into one canonical label per run.
 *
 * The rule from `docs/REVIEW-RECONCILIATION.md`: where every reading of a run agrees, the run
 * is unanimous and the label stands. Where they split, the majority does not decide. A
 * reading that is only the heuristic's output would otherwise be counted as a vote, and on
 * season 0 a majority would have let one regex outvote the only actual reading of the text.
 * A split goes to a person, who adjudicates on the evidence and writes the verdict down.
 *
 * Pure over labels; nothing here reads a store.
 */

export type Reading = { runId: number; winner: string | null; note: string };
export type Labelled = { source: string; readings: Reading[] };

export type RunVerdicts = {
  runId: number;
  /** Each source's label for this run, in the order the sources were given. */
  labels: { source: string; winner: string | null; note: string }[];
};

export type Reconciliation = {
  unanimous: Reading[];
  splits: RunVerdicts[];
  /** Runs a full source expected and did not label. Any entry here stops the merge. */
  missing: { source: string; runId: number }[];
  /** Labels outside the vocabulary: a typo here would become a platform of its own. */
  unknownNames: { source: string; runId: number; winner: string }[];
};

const key = (w: string | null) => w ?? "none";

export function reconcile(
  runIds: number[],
  sources: (Labelled & { covers: number[] })[],
  vocabulary: string[],
): Reconciliation {
  const missing: Reconciliation["missing"] = [];
  const unknownNames: Reconciliation["unknownNames"] = [];
  const known = new Set(vocabulary);
  const by = sources.map((s) => {
    const m = new Map<number, Reading>();
    for (const r of s.readings) {
      m.set(r.runId, r);
      if (r.winner !== null && !known.has(r.winner)) unknownNames.push({ source: s.source, runId: r.runId, winner: r.winner });
    }
    for (const id of s.covers) if (!m.has(id)) missing.push({ source: s.source, runId: id });
    return { source: s.source, m };
  });

  const unanimous: Reading[] = [];
  const splits: RunVerdicts[] = [];
  for (const runId of [...runIds].sort((a, b) => a - b)) {
    const labels = by.flatMap(({ source, m }) => {
      const r = m.get(runId);
      return r ? [{ source, winner: r.winner, note: r.note }] : [];
    });
    if (!labels.length) continue;
    if (new Set(labels.map((l) => key(l.winner))).size === 1) {
      // The note of the first reading that is not the heuristic: the sentence a person read.
      const lead = labels.find((l) => l.source !== "heuristic") ?? labels[0];
      unanimous.push({ runId, winner: labels[0].winner, note: `Unanimous across ${labels.length} readings. ${lead.note}` });
    } else {
      splits.push({ runId, labels });
    }
  }
  return { unanimous, splits, missing, unknownNames };
}

/** The canonical file: every unanimous run, then every split with its written verdict. */
export function canonical(r: Reconciliation, verdicts: Reading[]): Reading[] {
  const decided = new Map(verdicts.map((v) => [v.runId, v]));
  const open = r.splits.filter((s) => !decided.has(s.runId)).map((s) => s.runId);
  if (open.length) throw new Error(`no verdict written for split run(s) ${open.join(", ")}`);
  return [...r.unanimous, ...r.splits.map((s) => decided.get(s.runId)!)].sort((a, b) => a.runId - b.runId);
}
