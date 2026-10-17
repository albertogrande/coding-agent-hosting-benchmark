/**
 * Who owns the pages an engine read.
 *
 * A mention rate says whether the answer named the brand. It cannot say why. The original
 * analysis found the mechanism underneath by asking a different question of the same runs —
 * on the prompts the brand lost, whose pages did the engine actually consult? — and the
 * answer separated a retrieval failure from a persuasion failure, which are different
 * problems with different fixes. That computation is this file.
 *
 * Three buckets, and only three. `own` and `competitor` are read from each platform's
 * declared `domains`; everything else is `other` and stays there. Sub-classifying the rest
 * (comparison farms, community, docs aggregators) needs a curated host list, which is a
 * judgement, and a judgement belongs in the review queue rather than in a bucket that a
 * report will quote as fact.
 */
import type { Alias } from "@/db/schema";

export type Owner = "own" | "competitor" | "other";

/** One cited page, as the store holds it. */
export type CitationRow = {
  runId: number;
  promptKey: string;
  host: string | null;
  /** citation | search_result | fetch — never pooled, see `ownershipByKind`. */
  kind: string;
  /** The stance of the run that read this page, or null when it was never graded. */
  stance: string | null;
};

export type OwnerCounts = { own: number; competitor: number; other: number; total: number };

/** Counts plus the share each bucket holds, as a fraction of `total`. */
export type OwnerShare = OwnerCounts & { share: Record<Owner, number> };

const EMPTY = (): OwnerCounts => ({ own: 0, competitor: 0, other: 0, total: 0 });

/**
 * True when `host` is the domain itself or a subdomain of it.
 *
 * The suffix has to be tested with the dot included. Without it `notrender.com` ends with
 * `render.com` and a rival's attack page becomes one of that platform's own citations —
 * the single easiest way to turn this metric into a lie that flatters.
 */
function under(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Who owns a host. The brand is tested first, so a domain listed on both sides resolves to
 * the brand rather than by list order.
 *
 * A platform with no declared domains can never match, so its pages fall to `other`. That
 * is deliberate: an empty config should make the number obviously missing, not quietly zero.
 */
export function hostOwner(host: string | null, brand: Alias, competitors: Alias[]): Owner {
  if (!host) return "other";
  const h = host.replace(/^www\./, "").toLowerCase();
  if ((brand.domains ?? []).some((d) => under(h, d))) return "own";
  if (competitors.some((c) => (c.domains ?? []).some((d) => under(h, d)))) return "competitor";
  return "other";
}

function tally(rows: CitationRow[], brand: Alias, competitors: Alias[]): OwnerCounts {
  const c = EMPTY();
  for (const r of rows) {
    c[hostOwner(r.host, brand, competitors)] += 1;
    c.total += 1;
  }
  return c;
}

const withShare = (c: OwnerCounts): OwnerShare => ({
  ...c,
  share: {
    own: c.total ? c.own / c.total : 0,
    competitor: c.total ? c.competitor / c.total : 0,
    other: c.total ? c.other / c.total : 0,
  },
});

/** Ownership across every page in the input, ignoring what kind of page it was. */
export function ownership(rows: CitationRow[], brand: Alias, competitors: Alias[]): OwnerShare {
  return withShare(tally(rows, brand, competitors));
}

/**
 * Ownership per `kind`, which is the only form this number should be reported in.
 *
 * A citation attached to an answer, a search result the engine merely saw, and a page it
 * opened are three different events. Summing them produces a figure whose denominator
 * means nothing, and the same units rule already governs `searchCount` on the health card.
 */
export function ownershipByKind(
  rows: CitationRow[],
  brand: Alias,
  competitors: Alias[],
): { kind: string; counts: OwnerShare }[] {
  const byKind = new Map<string, CitationRow[]>();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind)!.push(r);
  }
  return [...byKind.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, rs]) => ({ kind, counts: withShare(tally(rs, brand, competitors)) }));
}

export type OutcomeSplit = {
  /** Prompts where the brand reached `mentioned` or beyond in at least half its runs. */
  won: OwnerShare & { prompts: number };
  lost: OwnerShare & { prompts: number };
  /**
   * Points of owned share on won prompts minus lost. Null when either side has no pages,
   * because a difference against an empty denominator is not a small difference.
   */
  gapPp: number | null;
};

/** Runs at or beyond this stance count as the brand having been present in the answer. */
const PRESENT = new Set(["mentioned", "shortlisted", "recommended"]);

/**
 * The finding: owned share on the prompts the brand wins versus the ones it loses.
 *
 * A prompt is won when the brand was present in at least half of its gradeable runs — the
 * same 50% line the original used. Ungraded and voided runs decide nothing: they are
 * excluded from the win test rather than counted as losses, because a run that could not be
 * graded is not evidence that the brand was absent.
 *
 * Both page counts travel with the shares. The claim these support is a ratio between two
 * supports, and a ratio whose denominators are hidden is the kind of figure that survives
 * review by being unreadable.
 */
export function ownedRateByOutcome(
  rows: CitationRow[],
  brand: Alias,
  competitors: Alias[],
  opts: { kind?: string } = {},
): OutcomeSplit {
  const scoped = opts.kind ? rows.filter((r) => r.kind === opts.kind) : rows;

  // Presence is a property of a run, not of a page: a run citing forty pages still casts
  // one vote on whether its prompt was won, so collapse to runs before counting.
  const graded = new Map<string, { present: number; n: number }>();
  const seen = new Set<number>();
  for (const r of scoped) {
    if (r.stance === null || r.stance === "voided" || seen.has(r.runId)) continue;
    seen.add(r.runId);
    const g = graded.get(r.promptKey) ?? { present: 0, n: 0 };
    g.n += 1;
    if (PRESENT.has(r.stance)) g.present += 1;
    graded.set(r.promptKey, g);
  }

  const isWon = (key: string) => {
    const g = graded.get(key);
    return !!g && g.n > 0 && g.present / g.n >= 0.5;
  };

  const wonRows = scoped.filter((r) => isWon(r.promptKey));
  const lostRows = scoped.filter((r) => graded.has(r.promptKey) && !isWon(r.promptKey));

  const won = { ...withShare(tally(wonRows, brand, competitors)), prompts: new Set(wonRows.map((r) => r.promptKey)).size };
  const lost = { ...withShare(tally(lostRows, brand, competitors)), prompts: new Set(lostRows.map((r) => r.promptKey)).size };

  return {
    won,
    lost,
    gapPp: won.total && lost.total ? (won.share.own - lost.share.own) * 100 : null,
  };
}
