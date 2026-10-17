/**
 * A benchmark: every platform scored on the same prompts, by the same rules.
 *
 * The rest of this app is deliberately brand-centric — one brand, its rivals ranked
 * relative to it, a funnel that asks how *this* brand did. A published league table cannot
 * be shaped that way. If the prompt set was written around one entrant's categories, or the
 * scoring privileges one entrant's name, the table is an advertisement with a methodology
 * section.
 *
 * So this module refuses two things outright rather than warning about them: prompts that
 * name a platform, and pooling engines into one column. Both refusals cost coverage. Both
 * are the reason a number here can be published under your own name.
 */
import type { ExplorerRow } from "@/db/grades-repo";
import { hostOwner, type CitationRow } from "./citations";
import type { Alias } from "@/db/schema";
import { reportsSourcesWhenSearching } from "@/lib/surfaces";

export type PlatformScore = {
  platform: string;
  /** Gradeable runs in this engine's column — the denominator for every rate below. */
  runs: number;
  /** Runs naming the platform at all. */
  named: number;
  presence: number;
  /** Runs where the answer committed to this platform. */
  wins: number;
  winRate: number;
  /** Median position among platforms named, by first appearance. Null when never named. */
  medianRank: number | null;
  /** Pages cited on this platform's own domains, over all pages cited in the column. */
  ownedCitations: number;
  ownedShare: number;
  /** 95% interval for `presence`, from resampling prompts. Absent with too few prompts. */
  ci?: { lo: number; hi: number };
};

export type EngineTable = {
  engine: string;
  runs: number;
  voided: number;
  /** Pages cited across every run in this column. The denominator for `ownedShare`. */
  pagesCited: number;
  /** Gradeable runs that ran at least one search. */
  searched: number;
  /**
   * Searched and stored nothing — an extraction fault in the adapter, in the health card's
   * own words, never a finding that the platform was not cited.
   */
  sourceGap: number;
  /**
   * False when this column's citation figures would describe the instrument rather than
   * anyone's content — either because no page was recorded at all, or because a surface
   * that owes sources when it searches did not deliver them.
   *
   * The test asks the surface. An API returns what it consulted, so searching without
   * storing means the adapter lost it. A CLI opens a page only when it decides to, so the
   * same shape is a real decision — the earlier agent work found one engine deciding from
   * search snippets across 45 runs without opening a single page, and printing that as a
   * fault would libel the measurement.
   */
  citationsReportable: boolean;
  /**
   * How often a repeated cell disagreed with itself, in points. Any gap between two
   * platforms smaller than this is not a ranking — it is the instrument moving.
   */
  noiseFloorPp: number | null;
  scores: PlatformScore[];
};

export type Benchmark = {
  engines: EngineTable[];
  /** Platforms in the order the table should present them, by pooled presence. */
  platforms: string[];
  promptCount: number;
  /** Stated on the page, because a reader cannot check what they are not told. */
  notes: string[];
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A prompt naming one of the entrants is not a benchmark question.
 *
 * "Is Render good for production?" measures reputation; "where should I deploy this Go
 * service?" measures selection. Mixing them hands every point in the branded half to
 * whoever was named, and the resulting table says more about the prompt set than the
 * market. Thrown, not warned: a warning would end up in a published table.
 */
export function namedEntrants(
  prompts: { key: string; text: string }[],
  platforms: Alias[],
): { key: string; platform: string }[] {
  const out: { key: string; platform: string }[] = [];
  for (const p of prompts) {
    for (const pl of platforms) {
      const hit = [pl.name, ...pl.aliases].some((a) =>
        new RegExp(`(?<![\\w.])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(p.text));
      if (hit) { out.push({ key: p.key, platform: pl.name }); break; }
    }
  }
  return out;
}

export function assertUnbranded(prompts: { key: string; text: string }[], platforms: Alias[]): void {
  const named = namedEntrants(prompts, platforms);
  if (named.length) {
    throw new Error(
      `benchmark refused — ${named.length} prompt(s) name an entrant, which decides the result ` +
      `before the engines answer:\n  ${named.slice(0, 5).map((n) => `${n.key} names ${n.platform}`).join("\n  ")}` +
      (named.length > 5 ? `\n  …and ${named.length - 5} more` : "") +
      `\n\nDrop them with --exclude-branded, which states the exclusion on the page.`,
    );
  }
}

/**
 * Splits a wave's runs by whether the machine that produced them could have tilted them.
 *
 * A deploy credential on disk, a personal global CLAUDE.md, a user-scope MCP server or an
 * unshimmed deploy CLI all reach an agent cell and none can be stripped from the child, so
 * a run made on such an account measures the laptop as much as the model — which is
 * exactly how two cells in the original agent wave came to choose Railway because a token
 * was lying there.
 *
 * `null` is not `false`. Every imported row predates the stamp, and treating "not known"
 * as "not clean" would throw away the history the benchmark is compared against.
 */
export function splitByProvenance<T extends { envClean: boolean | null; account: string | null }>(
  rows: T[],
): { usable: T[]; unclean: T[]; accounts: string[] } {
  const unclean = rows.filter((r) => r.envClean === false);
  return {
    usable: rows.filter((r) => r.envClean !== false),
    unclean,
    accounts: [...new Set(unclean.map((r) => r.account ?? "unknown account"))],
  };
}

function scoreColumn(
  rows: ExplorerRow[],
  cites: CitationRow[],
  platforms: Alias[],
): PlatformScore[] {
  const gradeable = rows.filter((r) => r.stance && r.stance !== "voided");
  const runs = gradeable.length;
  const ci = presenceIntervals(rows, platforms);

  return platforms.map((pl) => {
    const named = gradeable.filter((r) => (r.platformsNamed ?? []).includes(pl.name));
    const ranks = named
      .map((r) => (r.platformsNamed ?? []).indexOf(pl.name) + 1)
      .filter((n) => n > 0);
    const wins = gradeable.filter((r) => r.winner === pl.name).length;
    const owned = cites.filter((c) => hostOwner(c.host, pl, []) === "own").length;

    return {
      platform: pl.name,
      runs,
      named: named.length,
      presence: runs ? named.length / runs : 0,
      wins,
      winRate: runs ? wins / runs : 0,
      medianRank: median(ranks),
      ownedCitations: owned,
      ownedShare: cites.length ? owned / cites.length : 0,
      ...(ci.get(pl.name) ? { ci: ci.get(pl.name) } : {}),
    };
  });
}

/**
 * Score every platform, per engine.
 *
 * `platforms` is a flat list with no focal brand — the caller passes brand and competitors
 * concatenated, and nothing downstream can tell which was which. That is the point: the
 * table has no home team.
 *
 * Engines are separate tables rather than columns of one, because pooling them is how a
 * real dataset produced a tie between two platforms whose per-engine results pointed in
 * opposite directions, and it had to be corrected in public.
 */
export function benchmark(
  rows: ExplorerRow[],
  cites: CitationRow[],
  platforms: Alias[],
  opts: { noiseFloorPp?: (engine: string) => number | null } = {},
): Benchmark {
  const byEngine = new Map<string, ExplorerRow[]>();
  for (const r of rows) {
    if (!byEngine.has(r.surfaceLabel)) byEngine.set(r.surfaceLabel, []);
    byEngine.get(r.surfaceLabel)!.push(r);
  }

  const runIdsBy = (rs: ExplorerRow[]) => new Set(rs.map((r) => r.runId));

  const engines: EngineTable[] = [...byEngine.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([engine, rs]) => {
      const ids = runIdsBy(rs);
      const cs = cites.filter((c) => ids.has(c.runId));
      const gradeable = rs.filter((r) => r.stance && r.stance !== "voided");
      const searched = gradeable.filter((r) => (r.searchCount ?? 0) > 0);
      const sourceGap = searched.filter((r) => r.sourceCount === 0).length;
      const owesSources = rs.some((r) => reportsSourcesWhenSearching(r.surfaceKey));
      return {
        engine,
        runs: gradeable.length,
        voided: rs.filter((r) => r.stance === "voided").length,
        pagesCited: cs.length,
        searched: searched.length,
        sourceGap,
        // Half is a judgement, and a stated one: past it the column says more about the
        // adapter than about anyone's content. Under it the gap is still on the page.
        //
        // A surface that does not owe sources is judged on whether it recorded any pages at
        // all, never on how often it chose not to open one.
        citationsReportable: owesSources
          ? searched.length > 0 && sourceGap <= searched.length / 2
          : cs.length > 0,
        noiseFloorPp: opts.noiseFloorPp?.(engine) ?? null,
        scores: scoreColumn(rs, cs, platforms),
      };
    });

  // Presentation order only. Pooled across engines purely to decide row order, never to
  // produce a figure — the pooled number itself is not reported anywhere.
  const pooled = new Map<string, number>();
  for (const e of engines) {
    for (const s of e.scores) pooled.set(s.platform, (pooled.get(s.platform) ?? 0) + s.named);
  }

  return {
    engines,
    platforms: [...pooled.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p),
    promptCount: new Set(rows.map((r) => r.promptKey)).size,
    notes: [],
  };
}

/**
 * Whether two platforms' presence rates are far enough apart to be read as ranked.
 *
 * A league table invites the reader to treat adjacent rows as ordered. Most of the time
 * they are not, and saying so is the difference between a benchmark and a leaderboard.
 *
 * The test is interval overlap, not the wave's flip rate. Those measure different things
 * and confusing them was the first version of this file: the flip rate says how often *one
 * cell* changes its mind between repeats, which is large and interesting, but a presence
 * rate is an average over hundreds of runs and is far more stable than any single cell.
 * Judging aggregates by the flip rate called every row on a real page indistinguishable,
 * including a 27-point gap — conservative to the point of being wrong.
 */
export function separated(a: PlatformScore, b: PlatformScore): boolean {
  if (!a.ci || !b.ci) return false;
  return a.ci.lo > b.ci.hi || b.ci.lo > a.ci.hi;
}

/** Deterministic PRNG: a published interval has to come out the same on every re-run. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The thing a design repeats, which is the thing an interval has to resample.
 *
 * For chat it is the prompt: five repeats of one question are one question asked five
 * times. For an agent arm it is the repository: every prompt on one codebase reads the same
 * files, meets the same framework and the same disk requirement, and the runs agree with
 * each other for that reason rather than because of anything the prompt said. Clustering
 * on the prompt × repository cell would treat four prompts on one repository as four
 * independent readings and report a precision an eight-repository design cannot buy; the
 * say-versus-do comparison already resamples this way, and the two must agree.
 */
export const subjectOf = (r: { target: string; promptKey: string }): string => r.target || r.promptKey;

/**
 * A 95% interval for each platform's presence, by resampling **subjects**, not runs.
 *
 * Resampling runs would treat five repeats of one prompt as five independent observations.
 * They are not — they are one question asked five times, and the repeats agree with each
 * other far more than two different prompts do. Clustering on the subject is what keeps the
 * interval honest; doing it the naive way would report a precision this design cannot buy.
 */
export function presenceIntervals(
  rows: ExplorerRow[],
  platforms: Alias[],
  opts: { iterations?: number; seed?: number } = {},
): Map<string, { lo: number; hi: number }> {
  const iterations = opts.iterations ?? 800;
  const rand = mulberry32(opts.seed ?? 20260828);

  const gradeable = rows.filter((r) => r.stance && r.stance !== "voided");
  const bySubject = new Map<string, ExplorerRow[]>();
  for (const r of gradeable) {
    const k = subjectOf(r);
    if (!bySubject.has(k)) bySubject.set(k, []);
    bySubject.get(k)!.push(r);
  }
  const clusters = [...bySubject.values()];
  const out = new Map<string, { lo: number; hi: number }>();
  if (clusters.length < 2) return out;

  for (const pl of platforms) {
    const samples: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      let named = 0;
      let n = 0;
      for (let c = 0; c < clusters.length; c += 1) {
        const cl = clusters[Math.floor(rand() * clusters.length)];
        for (const r of cl) {
          n += 1;
          if ((r.platformsNamed ?? []).includes(pl.name)) named += 1;
        }
      }
      samples.push(n ? named / n : 0);
    }
    samples.sort((x, y) => x - y);
    out.set(pl.name, {
      lo: samples[Math.floor(iterations * 0.025)],
      hi: samples[Math.ceil(iterations * 0.975) - 1],
    });
  }
  return out;
}
