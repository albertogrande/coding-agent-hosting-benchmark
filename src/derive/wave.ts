/**
 * The wave-health card.
 *
 * This is the part of the app that justifies the app. Each section below corresponds to
 * a defect that shipped in a real dataset and was found nine months later, by hand:
 *
 *   balance   — 519 runs against a designed 460, every headline number engine-weighted
 *   truncation— a 2048-token ceiling that cut 46% of one engine's answers and produced
 *               twelve empty ones, each scored as if the brand had lost
 *   coverage  — 149 of 150 runs recorded a search count and no sources at all
 *   units     — two providers' search counts compared in one column
 *
 * None of them needed cleverness to catch. They needed someone to look, so the card
 * looks every time, and says so on the wave page whether or not anything is wrong.
 */
import type { WaveRow } from "@/db/waves";
import { reportsSourcesWhenSearching } from "@/lib/surfaces";

export type SurfaceHealth = {
  surfaceKey: string;
  surfaceLabel: string;
  runs: number;
  planned: number;
  /** Runs whose answer stopped early. Never counted as an answer. */
  truncated: number;
  errored: number;
  /** Ran at least one search. */
  searched: number;
  /** Searched and stored at least one source. */
  searchedWithSources: number;
  /** Searched and stored none — an extraction fault, not a finding about the brand. */
  sourceGap: number;
  /**
   * Runs where a tool the model called reported a failure. The answer still arrives as
   * prose, so nothing else about the run looks wrong — which is exactly why this is
   * counted rather than left in the transcript.
   */
  toolFailed: number;
  searchUnits: string[];
  medianAnswerChars: number;
  costUsd: number;
  /**
   * Runs whose response named a different model from the one the wave asked for. A
   * provider that swaps the model behind an alias changes the instrument mid-wave; a
   * wave with any of these is two waves wearing one label.
   */
  modelDrift: number;
  /** Runs whose response named no model at all. Unknown — never counted as agreement. */
  modelUnknown: number;
  /** The CLI or SDK releases that produced this surface's runs. More than one is a note. */
  toolVersions: string[];
};

export type BalanceIssue = { surfaceLabel: string; planned: number; actual: number };

export type WaveHealth = {
  runs: number;
  planned: number;
  balanced: boolean;
  balanceIssues: BalanceIssue[];
  truncated: number;
  errored: number;
  sourceGap: number;
  toolFailed: number;
  costUsd: number;
  surfaces: SurfaceHealth[];
  /**
   * True when the surfaces in this wave report search counts in different units, which
   * makes any cross-surface comparison of that column meaningless.
   */
  mixedSearchUnits: boolean;
  /** Human-readable problems, most serious first. Empty means the wave is sound. */
  warnings: string[];
};

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function waveHealth(
  rows: WaveRow[],
  planned: { surfaceKey: string; surfaceLabel: string; planned: number }[],
): WaveHealth {
  const bySurface = new Map<string, WaveRow[]>();
  for (const r of rows) {
    if (!bySurface.has(r.surfaceLabel)) bySurface.set(r.surfaceLabel, []);
    bySurface.get(r.surfaceLabel)!.push(r);
  }

  const rs = (s: { surfaceLabel: string }) => bySurface.get(s.surfaceLabel) ?? [];
  const surfaces: SurfaceHealth[] = planned.map((p) => {
    const rs = bySurface.get(p.surfaceLabel) ?? [];
    const searched = rs.filter((r) => (r.searchCount ?? 0) > 0);
    return {
      surfaceKey: p.surfaceKey,
      surfaceLabel: p.surfaceLabel,
      runs: rs.length,
      planned: p.planned,
      truncated: rs.filter((r) => r.truncated).length,
      errored: rs.filter((r) => r.status === "error").length,
      searched: searched.length,
      searchedWithSources: searched.filter((r) => r.sourceCount > 0).length,
      // Only counted where the surface owes sources when it searches. On a CLI surface a
      // search that opened no page is the engine deciding from snippets — a finding about
      // how it works, and the opposite of an adapter fault.
      sourceGap: reportsSourcesWhenSearching(p.surfaceKey)
        ? searched.filter((r) => r.sourceCount === 0).length
        : 0,
      toolFailed: rs.filter((r) => (r.toolErrors ?? []).length > 0).length,
      searchUnits: [...new Set(rs.map((r) => r.searchUnit).filter(Boolean) as string[])],
      medianAnswerChars: median(rs.filter((r) => !r.truncated).map((r) => (r.text ?? "").length)),
      costUsd: rs.reduce((a, r) => a + (r.costUsd ?? 0), 0) / 1e6,
      // Error rows never answered, so they have no model to disagree with.
      modelDrift: rs.filter((r) => r.status !== "error" && r.modelResolved && r.modelRequested && r.modelResolved !== r.modelRequested).length,
      modelUnknown: rs.filter((r) => r.status !== "error" && !r.modelResolved).length,
      toolVersions: [...new Set(rs.map((r) => r.toolVersion).filter(Boolean) as string[])],
    };
  });

  // A wave that has not started is not unbalanced — it is not started, and saying
  // otherwise puts a defect notice on every freshly planned wave, which is how a warnings
  // section gets ignored.
  const started = rows.length > 0;
  const balanceIssues = started
    ? surfaces
        .filter((s) => s.runs !== s.planned)
        .map((s) => ({ surfaceLabel: s.surfaceLabel, planned: s.planned, actual: s.runs }))
    : [];

  const allUnits = new Set(surfaces.flatMap((s) => s.searchUnits));
  const health: WaveHealth = {
    runs: rows.length,
    planned: planned.reduce((a, p) => a + p.planned, 0),
    balanced: balanceIssues.length === 0,
    balanceIssues,
    truncated: surfaces.reduce((a, s) => a + s.truncated, 0),
    errored: surfaces.reduce((a, s) => a + s.errored, 0),
    sourceGap: surfaces.reduce((a, s) => a + s.sourceGap, 0),
    toolFailed: surfaces.reduce((a, s) => a + s.toolFailed, 0),
    costUsd: surfaces.reduce((a, s) => a + s.costUsd, 0),
    surfaces,
    mixedSearchUnits: allUnits.size > 1,
    warnings: [],
  };

  // Ordered by how badly each one would distort a conclusion drawn from this wave.
  if (balanceIssues.length) {
    health.warnings.push(
      `Unbalanced: ${balanceIssues.map((b) => `${b.surfaceLabel} has ${b.actual} of ${b.planned}`).join("; ")}. ` +
      `Pooled rates are weighted toward whichever surface has more runs until this is closed.`,
    );
  }
  for (const s of surfaces) {
    if (s.sourceGap) {
      health.warnings.push(
        `${s.surfaceLabel}: ${s.sourceGap} of ${s.searched} searching runs stored no sources. ` +
        `That is an extraction fault in the adapter, not evidence about the brand — do not read it as "the brand was not in the results".`,
      );
    }
    if (s.toolFailed) {
      health.warnings.push(
        `${s.surfaceLabel}: a tool call failed on ${s.toolFailed} of ${s.runs} runs. ` +
        `The model still answered, so these look healthy from the outside — read them as ` +
        `a broken instrument on those runs, never as what the engine found.`,
      );
    }
    if (s.truncated) {
      const pct = Math.round((100 * s.truncated) / Math.max(1, s.runs));
      health.warnings.push(
        `${s.surfaceLabel}: ${s.truncated} run(s) (${pct}%) stopped early and are voided, not graded. ` +
        `Raise this surface's output budget and re-run them.`,
      );
    }
    if (s.modelDrift) {
      const served = [...new Set(rs(s).filter((r) => r.modelResolved && r.modelResolved !== r.modelRequested).map((r) => r.modelResolved))];
      health.warnings.push(
        `${s.surfaceLabel}: ${s.modelDrift} of ${s.runs} runs were answered by ${served.join(", ")}, not the planned model. ` +
        `That is a different instrument under the same label — split them before comparing anything.`,
      );
    }
    if (s.modelUnknown) {
      health.warnings.push(
        `${s.surfaceLabel}: ${s.modelUnknown} of ${s.runs} runs do not say which model answered. ` +
        `Unknown, not confirmed — the served-model check cannot cover them.`,
      );
    }
    if (s.toolVersions.length > 1) {
      health.warnings.push(
        `${s.surfaceLabel}: runs came from ${s.toolVersions.length} CLI releases (${s.toolVersions.join(", ")}). ` +
        `Same model, different system prompt and tools — say so wherever this wave is quoted.`,
      );
    }
  }
  if (health.mixedSearchUnits) {
    health.warnings.push(
      `Search counts are in different units across surfaces (${[...allUnits].join(", ")}). ` +
      `They are comparable within a surface and meaningless across surfaces.`,
    );
  }
  return health;
}

/**
 * Whether these rows may be pooled into one figure.
 *
 * Aggregate and per-category rates may pool surfaces; anything that compares the brand
 * against a rival, or reads a factor's effect, may not — the same prompt set produced
 * opposite shape effects on two engines, and the pooled cut averaged them into a finding
 * that was true of neither.
 */
export type PoolScope = "aggregate" | "category" | "brand-vs-brand" | "factor";

export function assertPoolable(rows: WaveRow[], scope: PoolScope): void {
  const surfaces = new Set(rows.map((r) => r.surfaceLabel));
  if (surfaces.size <= 1) return;
  if (scope === "aggregate" || scope === "category") return;
  throw new Error(
    `refusing to pool ${surfaces.size} surfaces for a ${scope} comparison ` +
    `(${[...surfaces].join(", ")}). Split by surface, or ask for an aggregate.`,
  );
}

/** Branded and unbranded prompts measure different things and never share a rate. */
export function assertSingleBrandedness(rows: WaveRow[]): void {
  const kinds = new Set(rows.map((r) => r.branded));
  if (kinds.size > 1) {
    throw new Error(
      "refusing to mix branded and unbranded prompts in one figure: a branded prompt " +
      "guarantees a mention by construction, so the two measure different things.",
    );
  }
}

// ------------------------------------------------------------------ stability

/**
 * How often the repeats of one cell disagree with each other.
 *
 * This is the arm's own error bar, and the reason it is a default column rather than a
 * footnote: the original agent arm ran twelve cells twice, two of them came back with
 * different platforms — one of those a win for the brand — and the code computed that
 * count into a variable that nothing ever rendered. A reader saw the repeats in the
 * denominator and never learned what they measured.
 *
 * Only cells with at least two gradeable repeats count. Voided runs are excluded: a run
 * that never finished cannot agree or disagree with anything.
 */
export type Stability = {
  /** Cells with two or more gradeable repeats. */
  comparable: number;
  /** …of which every repeat produced the same stance. */
  stable: number;
  flipped: number;
  /** Cells where the repeats picked different winning platforms. */
  winnerFlipped: number;
  flipRate: number | null;
  examples: { cellId: number; label: string; stances: string[] }[];
};

export type StabilityInput = {
  cellId: number;
  surfaceLabel: string;
  topic: string | null;
  /** The repository, for agent cells, where the subject is not the prompt's topic. */
  target?: string;
  stance: string | null;
  winner: string | null;
};

export function stability(rows: StabilityInput[]): Stability {
  const byCell = new Map<number, StabilityInput[]>();
  for (const r of rows) {
    if (!r.stance || r.stance === "voided") continue;
    if (!byCell.has(r.cellId)) byCell.set(r.cellId, []);
    byCell.get(r.cellId)!.push(r);
  }

  let comparable = 0, stable = 0, winnerFlipped = 0;
  const examples: Stability["examples"] = [];

  for (const [cellId, reps] of byCell) {
    if (reps.length < 2) continue;
    comparable += 1;
    const stances = reps.map((r) => r.stance!);
    const winners = new Set(reps.map((r) => r.winner ?? ""));
    if (new Set(stances).size === 1) stable += 1;
    else if (examples.length < 8) {
      examples.push({
        cellId,
        // Whatever names this cell: a chat topic, or the repository an agent ran against.
        label: `${reps[0].topic || reps[0].target || "—"} · ${reps[0].surfaceLabel}`,
        stances,
      });
    }
    if (winners.size > 1) winnerFlipped += 1;
  }

  const flipped = comparable - stable;
  return {
    comparable, stable, flipped, winnerFlipped,
    flipRate: comparable ? flipped / comparable : null,
    examples,
  };
}
