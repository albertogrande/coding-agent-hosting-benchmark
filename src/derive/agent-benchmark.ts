/**
 * The report for an agent arm: what a coding agent committed to, per platform, per
 * repository, per frame — and how it got there.
 *
 * A separate module from `benchmark.ts` on purpose. That one is chat-shaped: its headline
 * is presence (how often a platform is *named*) and it carries citation-ownership tables.
 * An agent barely cites and being named in passing is its weakest signal; what it wrote
 * into the tree is the measurement. So the headline here is adoption, the error bar is the
 * repeat flip rate, and the first cut is by repository, because the August work found the
 * workload shape deciding the platform (Render took five of seven cells because
 * `render.yaml` can declare a disk). A report that only pools hides its own mechanism.
 *
 * Every figure below is a pure function over stored rows. Nothing is typed by hand.
 */
import type { Alias, ToolEvent } from "@/db/schema";
import { isAgentSurface } from "@/lib/surfaces";

/** One stored agent run, with everything the report and the explorer read off it. */
export type AgentRow = {
  runId: number;
  cellId: number;
  rep: number;
  status: string;
  truncated: boolean;
  stopReason: string | null;
  text: string | null;
  promptKey: string;
  promptText: string;
  /** The constraint the prompt sets: least-effort, cost, production, open. */
  frame: string;
  /** The repository the cell ran against. */
  target: string;
  surfaceKey: string;
  surfaceLabel: string;
  modelRequested: string | null;
  modelResolved: string | null;
  toolVersion: string | null;
  /** The container the run executed in, by tag and digest, or null when it ran on the host. */
  /** Where the run executed, and the effort it was given. `effort` is null when none was passed. */
  sandbox: { image: string; digest: string | null; cliVersion: string | null; effort?: string | null } | null;
  durationMs: number | null;
  ranAt: number;
  searchCount: number | null;
  searchQueries: string[];
  toolTimeline: ToolEvent[];
  toolErrors: string[];
  sources: { url: string; host: string | null; kind: string; rank: number | null }[];
  changedFiles: string[];
  repoUrl: string | null;
  baseSha: string | null;
  account: string | null;
  envClean: boolean | null;
  gradeId: number | null;
  /** decided | considered | silent | voided — how far the run got, about nobody. */
  reach: string | null;
  /** The platform the run committed to, as the grader resolved it. */
  adopted: string | null;
  platformsNamed: string[] | null;
  decisionMode: string | null;
  evidence: string | null;
  /** The ladder tier the verdict came from, and every rung it saw. From the raw record. */
  adoptionSource: string | null;
  adoptionEvidence: string[];
  adoptionConflict: string | null;
  needsReview: boolean | null;
  reviewNote: string | null;
  /** When a person relabelled the grade, as a unix second; null if the heuristics stand. */
  reviewedAt: number | null;
};

export type Interval = { lo: number; hi: number };

export type PlatformAdoption = {
  platform: string;
  /** Whether the platform is in the project's catalogue or came out of the answers. */
  listed: boolean;
  adopted: number;
  share: number;
  /** Runs that named the platform at all, adopted or not. */
  named: number;
  presence: number;
  /** 95% interval on `share`, resampling repositories. Absent with fewer than two. */
  ci?: Interval;
};

export type RepCell = {
  rep: number;
  runId: number;
  adopted: string | null;
  /** Did not finish or failed: shown as voided, never as "no platform". */
  voided: boolean;
  /** Stored but not yet graded at the current grader version. */
  ungraded: boolean;
};

export type FrameInRepository = {
  frame: string;
  promptKey: string;
  /** Empty when the plan owes this cell and nothing has run. */
  reps: RepCell[];
  /** True when every gradeable repeat committed to the same platform. */
  unanimous: boolean;
};

export type RepositoryCut = {
  target: string;
  /** True when the plan names this repository and nothing has run on it yet. */
  owed: boolean;
  repoUrl: string | null;
  baseSha: string | null;
  runs: number;
  gradeable: number;
  frames: FrameInRepository[];
  /** Platforms adopted on this repository, commonest first. */
  adopted: { platform: string; n: number }[];
  undecided: number;
  /** The commonest platform's share of gradeable runs here. */
  dominantShare: number;
};

export type FrameCut = {
  frame: string;
  promptKey: string;
  promptText: string;
  gradeable: number;
  adopted: { platform: string; n: number }[];
  undecided: number;
  /**
   * 95% interval on each platform's share within this frame, keyed by platform, with the
   * undecided share under `NO_PLATFORM`. Resamples repositories, like `adoption[].ci`; empty
   * when fewer than two repositories have a gradeable run in the frame.
   */
  intervals: Record<string, Interval>;
};

export type DecisionModeCut = {
  /** prior | search | fetch | unknown */
  mode: string;
  runs: number;
  adopted: { platform: string; n: number }[];
};

export type HostRead = { host: string; pages: number; runs: number; owner: string | null };

export type Stability = {
  /** Cells with two or more gradeable repeats. */
  comparable: number;
  /** …of which the repeats did not all commit to the same platform. */
  flipped: number;
  flipRate: number | null;
  examples: { cellId: number; target: string; frame: string; adopted: (string | null)[] }[];
};

export type Provenance = {
  accounts: string[];
  /** True when every run carries a clean stamp; false if any is unclean; null if unknown. */
  clean: boolean | null;
  modelRequested: string | null;
  modelsServed: { model: string; runs: number }[];
  /** Runs answered by something other than the planned model. */
  drift: number;
  cliVersions: string[];
  /** Distinct sandbox images the runs executed in, as `image@digest12`. Empty on the host. */
  images: string[];
  /** The same images with their full digest, for a reader who wants to pull or compare one. */
  sandboxes: { image: string; digest: string | null }[];
  /**
   * The effort each run was given, counted. `null` means none was passed and the CLI used its
   * default for the model, which differs by model (Opus 5: high, Opus 5.5: medium), so a
   * season compared with another has to say which it was.
   */
  efforts: { effort: string | null; runs: number }[];
  /** Runs a person relabelled, and when the last of them was. */
  reviewed: number;
  lastReviewedAt: number | null;
  firstRunAt: number | null;
  lastRunAt: number | null;
  durationMedianMs: number | null;
  durationMinMs: number | null;
  durationMaxMs: number | null;
};

export type AgentBenchmark = {
  surfaceKey: string;
  surfaceLabel: string;
  runs: number;
  gradeable: number;
  voided: number;
  errored: number;
  needsReview: number;
  /** Stored runs with no grade at the current grader version. Neither gradeable nor voided. */
  ungraded: number;
  /** Gradeable runs that committed to nothing. Shown, never folded into a platform. */
  undecided: number;
  repositories: string[];
  frames: string[];
  reps: number;
  adoption: PlatformAdoption[];
  byRepository: RepositoryCut[];
  byFrame: FrameCut[];
  decisionModes: DecisionModeCut[];
  /** Runs that ran at least one search; runs that opened at least one page. */
  searched: number;
  fetched: number;
  pagesOpened: number;
  hosts: HostRead[];
  stability: Stability;
  provenance: Provenance;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const tally = (names: (string | null)[]): { platform: string; n: number }[] => {
  const m = new Map<string, number>();
  for (const n of names) if (n) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].map(([platform, n]) => ({ platform, n }))
    .sort((a, b) => b.n - a.n || a.platform.localeCompare(b.platform));
};

/** Deterministic PRNG: a published interval has to come out the same on every re-run. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** `aeo-sandbox:s0@2a368b0692e4`: the tag and the first twelve hex digits of its digest. */
export const imageStamp = (s: { image: string; digest: string | null }): string =>
  s.digest ? `${s.image}@${s.digest.replace(/^sha256:/, "").slice(0, 12)}` : s.image;

export const isGradeable = (r: Pick<AgentRow, "reach" | "status">): boolean =>
  r.status !== "error" && !!r.reach && r.reach !== "voided";

/**
 * A 95% interval on a per-platform share, resampling **repositories**.
 *
 * Every frame on one codebase reads the same tree and meets the same disk requirement, so
 * the runs on it agree for that reason rather than because of anything the prompt said.
 * Clustering on the repository is the honest unit; with two repositories the interval is
 * wide, and that width is the pilot's finding rather than a defect of the method.
 */
export function adoptionIntervals(
  rows: AgentRow[],
  platforms: string[],
  opts: { iterations?: number; seed?: number } = {},
): Map<string, Interval> {
  const iterations = opts.iterations ?? 800;
  const gradeable = rows.filter(isGradeable);
  const byTarget = new Map<string, AgentRow[]>();
  for (const r of gradeable) {
    if (!byTarget.has(r.target)) byTarget.set(r.target, []);
    byTarget.get(r.target)!.push(r);
  }
  // Sorted by repository, so the resample does not depend on the order rows were read in:
  // a re-grade from the published file then reproduces the published interval exactly.
  const clusters = [...byTarget.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([, v]) => v);
  const out = new Map<string, Interval>();
  if (clusters.length < 2) return out;

  for (const pl of platforms) {
    // One sequence per platform, the same for each: an interval then depends on its own
    // platform's runs alone, not on how many platforms were listed before it.
    const rand = mulberry32(opts.seed ?? 20260828);
    const samples: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      let hit = 0, n = 0;
      for (let c = 0; c < clusters.length; c += 1) {
        const cl = clusters[Math.floor(rand() * clusters.length)];
        for (const r of cl) { n += 1; if (r.adopted === pl) hit += 1; }
      }
      samples.push(n ? hit / n : 0);
    }
    samples.sort((a, b) => a - b);
    out.set(pl, { lo: samples[Math.floor(iterations * 0.025)], hi: samples[Math.ceil(iterations * 0.975) - 1] });
  }
  return out;
}

/** The key under which a run that committed to nothing is counted in a per-frame interval. */
export const NO_PLATFORM = "(none)";

/**
 * The same interval, per frame: for every frame, each platform's share of that frame's
 * gradeable runs with a 95% bracket from resampling the repositories that ran in it, and
 * the undecided share under `NO_PLATFORM` so "no platform" is a bar with a bracket rather
 * than a remainder. A frame with fewer than two repositories draws no interval.
 *
 * The generator is reseeded per frame, so a frame's bracket does not depend on which frames
 * were drawn before it: one frame's interval on the page is the same figure whether the
 * wave ran one frame or four.
 */
export function frameAdoptionIntervals(
  rows: AgentRow[],
  platforms: string[],
  opts: { iterations?: number; seed?: number } = {},
): Map<string, Map<string, Interval>> {
  const iterations = opts.iterations ?? 800;
  const out = new Map<string, Map<string, Interval>>();
  for (const frame of [...new Set(rows.map((r) => r.frame))]) {
    const byTarget = new Map<string, AgentRow[]>();
    for (const r of rows.filter((x) => x.frame === frame && isGradeable(x))) {
      if (!byTarget.has(r.target)) byTarget.set(r.target, []);
      byTarget.get(r.target)!.push(r);
    }
    const clusters = [...byTarget.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([, v]) => v);
    const here = new Map<string, Interval>();
    out.set(frame, here);
    if (clusters.length < 2) continue;
    for (const pl of [...platforms, NO_PLATFORM]) {
      const rand = mulberry32(opts.seed ?? 20260828);
      const samples: number[] = [];
      for (let i = 0; i < iterations; i += 1) {
        let hit = 0, n = 0;
        for (let c = 0; c < clusters.length; c += 1) {
          const cl = clusters[Math.floor(rand() * clusters.length)];
          for (const r of cl) { n += 1; if ((r.adopted ?? NO_PLATFORM) === pl) hit += 1; }
        }
        samples.push(n ? hit / n : 0);
      }
      samples.sort((a, b) => a - b);
      here.set(pl, { lo: samples[Math.floor(iterations * 0.025)], hi: samples[Math.ceil(iterations * 0.975) - 1] });
    }
  }
  return out;
}

/** The platform whose declared domains own this host, if any. */
export function platformOfHost(host: string | null, platforms: Alias[]): string | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, "");
  for (const p of platforms) {
    for (const d of p.domains ?? []) {
      const dd = d.toLowerCase();
      if (h === dd || h.endsWith(`.${dd}`)) return p.name;
    }
  }
  return null;
}

/**
 * How often a cell disagreed with itself about which platform to adopt.
 *
 * The arm's own error bar. Counted on the adopted platform, not on the reach ladder: two
 * repeats that both "decided" but on different platforms are the disagreement that matters
 * here, and the reach vocabulary would call them stable.
 */
export function adoptionStability(rows: AgentRow[]): Stability {
  const byCell = new Map<number, AgentRow[]>();
  for (const r of rows.filter(isGradeable)) {
    if (!byCell.has(r.cellId)) byCell.set(r.cellId, []);
    byCell.get(r.cellId)!.push(r);
  }
  let comparable = 0, flipped = 0;
  const examples: Stability["examples"] = [];
  for (const [cellId, reps] of byCell) {
    if (reps.length < 2) continue;
    comparable += 1;
    const adopted = reps.map((r) => r.adopted);
    if (new Set(adopted.map((a) => a ?? "")).size > 1) {
      flipped += 1;
      if (examples.length < 8) examples.push({ cellId, target: reps[0].target, frame: reps[0].frame, adopted });
    }
  }
  return { comparable, flipped, flipRate: comparable ? flipped / comparable : null, examples };
}

/**
 * The report, from rows.
 *
 * Refuses chat rows: a chat answer is graded on how a platform *appears*, an agent run on
 * what it *wrote*, and one table cannot carry both. Refuses more than one agent surface for
 * the same reason the chat benchmark keeps engines apart — pooling two instruments is how a
 * measurement talks itself into a finding. Split the rows and render two reports.
 */
/**
 * What the wave was planned to run, so a page built mid-wave shows the cells still owed
 * rather than pretending the design was whatever has finished so far.
 */
export type Plan = { repositories?: string[]; frames?: string[]; reps?: number };

export function agentBenchmark(
  rows: AgentRow[],
  platforms: Alias[],
  opts: { iterations?: number; seed?: number; plan?: Plan } = {},
): AgentBenchmark {
  const chat = rows.filter((r) => !isAgentSurface(r.surfaceKey));
  if (chat.length) {
    throw new Error(
      `agent report refused — ${chat.length} row(s) are on a chat surface ` +
      `(${[...new Set(chat.map((r) => r.surfaceKey))].join(", ")}). This report reads what an agent ` +
      `wrote into a repository; a chat answer has no repository. Use the benchmark page for those.`,
    );
  }
  const surfaces = [...new Set(rows.map((r) => r.surfaceKey))];
  if (surfaces.length > 1) {
    throw new Error(
      `agent report refused — rows come from ${surfaces.length} agent surfaces (${surfaces.join(", ")}). ` +
      `One agent per report; render one per surface rather than pooling them.`,
    );
  }

  const gradeable = rows.filter(isGradeable);
  const undecided = gradeable.filter((r) => !r.adopted).length;

  // Presentation order: the plan's, then anything observed that the plan did not name.
  const repositories = [...new Set([...(opts.plan?.repositories ?? []), ...rows.map((r) => r.target)])];
  const frames = [...new Set([...(opts.plan?.frames ?? []), ...rows.map((r) => r.frame)])];
  const reps = opts.plan?.reps ?? Math.max(0, ...rows.map((r) => r.rep));

  // The catalogue plus whatever the answers named. A platform outside the catalogue is a
  // real result and is shown under the name the agent used, flagged as unlisted.
  const listed = platforms.map((p) => p.name);
  const seen = [...new Set(gradeable.map((r) => r.adopted).filter((a): a is string => !!a))];
  const field = [...listed, ...seen.filter((s) => !listed.includes(s))];
  const ci = adoptionIntervals(rows, field, opts);

  const adoption: PlatformAdoption[] = field.map((platform) => {
    const adopted = gradeable.filter((r) => r.adopted === platform).length;
    const named = gradeable.filter((r) => (r.platformsNamed ?? []).includes(platform)).length;
    return {
      platform,
      listed: listed.includes(platform),
      adopted,
      share: gradeable.length ? adopted / gradeable.length : 0,
      named,
      presence: gradeable.length ? named / gradeable.length : 0,
      ...(ci.get(platform) ? { ci: ci.get(platform) } : {}),
    };
  }).sort((a, b) => b.adopted - a.adopted || b.named - a.named || a.platform.localeCompare(b.platform));

  const byRepository: RepositoryCut[] = repositories.map((target) => {
    const here = rows.filter((r) => r.target === target);
    const g = here.filter(isGradeable);
    const t = tally(g.map((r) => r.adopted));
    return {
      target,
      owed: here.length === 0,
      repoUrl: here.find((r) => r.repoUrl)?.repoUrl ?? null,
      baseSha: here.find((r) => r.baseSha)?.baseSha ?? null,
      runs: here.length,
      gradeable: g.length,
      frames: frames
        .map((frame) => {
          const cell = here.filter((r) => r.frame === frame).sort((a, b) => a.rep - b.rep);
          const cg = cell.filter(isGradeable);
          return {
            frame,
            promptKey: cell[0]?.promptKey ?? rows.find((r) => r.frame === frame)?.promptKey ?? frame,
            reps: cell.map((r) => ({
              rep: r.rep, runId: r.runId,
              adopted: isGradeable(r) ? r.adopted : null,
              voided: !isGradeable(r) && (r.status === "error" || !!r.reach),
              ungraded: r.status !== "error" && !r.reach,
            })),
            unanimous: cg.length >= 2 && new Set(cg.map((r) => r.adopted ?? "")).size === 1 && !!cg[0].adopted,
          };
        }),
      adopted: t,
      undecided: g.filter((r) => !r.adopted).length,
      dominantShare: g.length && t.length ? t[0].n / g.length : 0,
    };
  });

  const frameCi = frameAdoptionIntervals(rows, field, opts);
  const byFrame: FrameCut[] = frames.map((frame) => {
    const here = rows.filter((r) => r.frame === frame);
    const g = here.filter(isGradeable);
    return {
      frame,
      promptKey: here[0]?.promptKey ?? frame,
      promptText: here[0]?.promptText ?? "",
      gradeable: g.length,
      adopted: tally(g.map((r) => r.adopted)),
      undecided: g.filter((r) => !r.adopted).length,
      intervals: Object.fromEntries(frameCi.get(frame) ?? []),
    };
  });

  const modes = ["prior", "search", "shell", "fetch", "unknown"];
  const decisionModes: DecisionModeCut[] = modes
    .map((mode) => {
      const here = gradeable.filter((r) => (r.decisionMode ?? "unknown") === mode);
      return { mode, runs: here.length, adopted: tally(here.map((r) => r.adopted)) };
    })
    .filter((m) => m.runs > 0);

  const hostMap = new Map<string, { pages: number; runs: Set<number> }>();
  let pagesOpened = 0;
  for (const r of gradeable) {
    for (const s of r.sources) {
      if (s.kind !== "fetch") continue;
      pagesOpened += 1;
      const h = (s.host ?? "").toLowerCase().replace(/^www\./, "") || "(no host)";
      if (!hostMap.has(h)) hostMap.set(h, { pages: 0, runs: new Set() });
      const e = hostMap.get(h)!;
      e.pages += 1;
      e.runs.add(r.runId);
    }
  }
  const hosts: HostRead[] = [...hostMap]
    .map(([host, e]) => ({ host, pages: e.pages, runs: e.runs.size, owner: platformOfHost(host, platforms) }))
    .sort((a, b) => b.pages - a.pages || a.host.localeCompare(b.host));

  const answered = rows.filter((r) => r.status !== "error");
  const served = tally(answered.map((r) => r.modelResolved));
  const modelRequested = rows.find((r) => r.modelRequested)?.modelRequested ?? null;
  const durations = answered.map((r) => r.durationMs).filter((d): d is number => typeof d === "number");
  const stamps = rows.map((r) => r.envClean);
  const sandboxes = new Map<string, { image: string; digest: string | null }>();
  for (const r of rows) if (r.sandbox) sandboxes.set(imageStamp(r.sandbox), { image: r.sandbox.image, digest: r.sandbox.digest });
  const reviewedAt = rows.map((r) => r.reviewedAt).filter((t): t is number => typeof t === "number");
  const provenance: Provenance = {
    accounts: [...new Set(rows.map((r) => r.account).filter((a): a is string => !!a))].sort(),
    clean: stamps.some((s) => s === false) ? false : stamps.some((s) => s === true) ? true : null,
    modelRequested,
    modelsServed: served.map((s) => ({ model: s.platform, runs: s.n })),
    drift: answered.filter((r) => r.modelResolved && modelRequested && r.modelResolved !== modelRequested).length,
    cliVersions: [...new Set(rows.map((r) => r.toolVersion).filter((v): v is string => !!v))].sort(),
    images: [...sandboxes.keys()].sort(),
    sandboxes: [...sandboxes].sort((a, b) => a[0].localeCompare(b[0])).map(([, s]) => s),
    efforts: [...rows.filter((r) => r.sandbox).reduce((m, r) => m.set(r.sandbox!.effort ?? null, (m.get(r.sandbox!.effort ?? null) ?? 0) + 1), new Map<string | null, number>())]
      .map(([effort, runs]) => ({ effort, runs })).sort((a, b) => b.runs - a.runs),
    reviewed: reviewedAt.length,
    lastReviewedAt: reviewedAt.length ? Math.max(...reviewedAt) : null,
    firstRunAt: rows.length ? Math.min(...rows.map((r) => r.ranAt)) : null,
    lastRunAt: rows.length ? Math.max(...rows.map((r) => r.ranAt)) : null,
    durationMedianMs: median(durations),
    durationMinMs: durations.length ? Math.min(...durations) : null,
    durationMaxMs: durations.length ? Math.max(...durations) : null,
  };

  return {
    surfaceKey: surfaces[0] ?? "",
    surfaceLabel: rows[0]?.surfaceLabel ?? "",
    runs: rows.length,
    gradeable: gradeable.length,
    voided: rows.filter((r) => r.status !== "error" && (r.reach === "voided" || r.truncated)).length,
    errored: rows.filter((r) => r.status === "error").length,
    needsReview: rows.filter((r) => r.needsReview).length,
    ungraded: rows.filter((r) => r.status !== "error" && !r.reach).length,
    undecided,
    repositories,
    frames,
    reps,
    adoption,
    byRepository,
    byFrame,
    decisionModes,
    searched: gradeable.filter((r) => (r.searchCount ?? 0) > 0).length,
    fetched: gradeable.filter((r) => r.sources.some((s) => s.kind === "fetch")).length,
    pagesOpened,
    hosts,
    stability: adoptionStability(rows),
    provenance,
  };
}
