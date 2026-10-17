/**
 * The funnel, and the cuts under it.
 *
 * Two counting conventions exist and they disagree by design, so the choice is a
 * parameter rather than a convention some pages happen to follow. The original project
 * had both in circulation — the same 400 runs read as 53% shortlisted in one place and
 * 61% in another — with the difference explained in a handoff note rather than in the
 * code that produced them.
 */
import type { ExplorerRow } from "@/db/grades-repo";

export type FunnelMode =
  /** Each run counted once, at the furthest stage it reached. Shares sum to 100%. */
  | "final"
  /** Each stage counts everything at or beyond it. This is the funnel proper. */
  | "cumulative";

export const STAGES = ["absent", "mentioned", "shortlisted", "recommended"] as const;
export type Stage = (typeof STAGES)[number];

export type Funnel = {
  mode: FunnelMode;
  /** Runs that produced a gradeable answer. Voided runs are never in a denominator. */
  graded: number;
  /** Counted separately and shown, never folded into `absent`. */
  voided: number;
  ungraded: number;
  counts: Record<Stage, number>;
  share: Record<Stage, number>;
};

const RANK: Record<string, number> = { absent: 0, mentioned: 1, shortlisted: 2, recommended: 3 };

/**
 * The ladder for whichever platform you point at, derived rather than stored.
 *
 * The four rungs are inherently about one platform — "absent" means *this one* did not
 * appear — so a benchmark with no home team cannot store a stance and call it the result.
 * It does not have to: every run already records which platforms it named and which one it
 * committed to, and those two facts answer the question for any platform in the field. So
 * the focal row becomes a lens held at reading time, and no name is written into the data as
 * the one the study is about.
 *
 * Voided runs pass straight through: a run that did not finish says nothing about anybody.
 */
export function stanceFor(
  row: Pick<ExplorerRow, "stance" | "winner" | "platformsNamed">,
  platform: string,
): Stage | "voided" | null {
  if (!row.stance) return null;
  if (row.stance === "voided") return "voided";
  if (row.winner === platform) return "recommended";
  if (!(row.platformsNamed ?? []).includes(platform)) return "absent";
  // Named, and something else was adopted — passed over rather than unseen. With nothing
  // adopted at all it was named but never weighed against a decision.
  return row.winner ? "shortlisted" : "mentioned";
}

/** The same rows, re-read about one platform. Feed the result to `funnel` or `cutBy`. */
export function through(rows: ExplorerRow[], platform: string): ExplorerRow[] {
  return rows.map((r) => ({ ...r, stance: stanceFor(r, platform) }));
}

export function funnel(rows: ExplorerRow[], mode: FunnelMode = "cumulative"): Funnel {
  const graded = rows.filter((r) => r.stance && r.stance !== "voided");
  const counts = { absent: 0, mentioned: 0, shortlisted: 0, recommended: 0 };

  for (const r of graded) {
    const at = RANK[r.stance!];
    if (at === undefined) continue;
    if (mode === "final" || at === 0) {
      counts[r.stance as Stage] += 1;
      continue;
    }
    /**
     * `absent` is the floor of the ladder, not a rung the funnel passes through: a run that
     * shortlisted the brand did not also fail to mention it. Rolling it up like the others
     * made `absent` equal the total in every cumulative funnel, so the wave page showed
     * "absent 100%" beside "shortlisted 33%" and, four rows below, its own per-surface split
     * saying 67% absent. Counted this way `absent + mentioned === graded`, which is a
     * property a reader can check on the page.
     */
    for (const st of STAGES) if (RANK[st] > 0 && RANK[st] <= at) counts[st] += 1;
  }

  const n = graded.length;
  return {
    mode,
    graded: n,
    voided: rows.filter((r) => r.stance === "voided").length,
    ungraded: rows.filter((r) => !r.stance).length,
    counts,
    share: {
      absent: n ? counts.absent / n : 0,
      mentioned: n ? counts.mentioned / n : 0,
      shortlisted: n ? counts.shortlisted / n : 0,
      recommended: n ? counts.recommended / n : 0,
    },
  };
}

export type Cut = { key: string; label: string; n: number; funnel: Funnel };

/** The same funnel, split by any facet. The split is what keeps engines unpooled. */
export function cutBy(
  rows: ExplorerRow[],
  pick: (r: ExplorerRow) => string | null,
  mode: FunnelMode = "final",
): Cut[] {
  const groups = new Map<string, ExplorerRow[]>();
  for (const r of rows) {
    const k = pick(r) ?? "—";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups].map(([key, rs]) => ({ key, label: key, n: rs.length, funnel: funnel(rs, mode) }));
}

/** Which rival wins most often, from the answers that actually committed to one. */
export function rivalWins(rows: ExplorerRow[], brandName: string): { name: string; n: number }[] {
  const tally = new Map<string, number>();
  for (const r of rows) {
    if (!r.winner || r.stance === "voided") continue;
    if (r.winner === brandName) continue;
    tally.set(r.winner, (tally.get(r.winner) ?? 0) + 1);
  }
  return [...tally].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}
