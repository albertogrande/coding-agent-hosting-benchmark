/**
 * The published dataset for an agent wave: one JSON file per wave, committed next to the
 * wave file, the way a benchmark commits its `latest-benchmark.json` so a number on the
 * page can be checked against a diff rather than against the author.
 *
 * Every run is in it with what the grader read and what it concluded, and the closing
 * message in full — that text is the grader's input, so re-grading from this file alone is
 * the reproducibility path that needs no login. The transcripts are not: forty megabytes
 * of tool calls belong in a release asset, not in git.
 *
 * "In full" has one exception, and `redacted` on the record says so out loud: a credential
 * the agent minted inside its sandbox, and the identifying half of a third party's email
 * address, come out on the way through (`src/lib/redact.ts`). Both are things a person who
 * never agreed to be in the experiment would have to live with being published; neither is
 * anything the grader reads. Domains survive, because platform names live in them.
 *
 * Pure: a benchmark and its rows in, a plain object out. Key order is the order written
 * here, so two builds of the same wave diff as an empty change.
 */
import type { AgentBenchmark, AgentRow, Interval, Stability } from "./agent-benchmark";
import { REDACTED, REDACTION_RULE, redact } from "../lib/redact";
import { agentClaims } from "./agent-claims";
import type { Claim } from "./claims";
import type { Alias } from "../db/schema";

/**
 * Version 2 adds `platforms`. Version 1 is still read (`src/derive/load-dataset.ts`), and
 * says out loud what it cannot restore.
 */
export const DATASET_SCHEMA = "aeo-tool/wave-dataset/3";

/** One platform as the recogniser matched it: the spellings behind every `named` count. */
export type DatasetPlatform = { name: string; aliases: string[]; domains: string[]; caseSensitive: boolean };

export type DatasetRun = {
  runId: number;
  cellId: number;
  rep: number;
  repository: { id: string; repoUrl: string | null; baseSha: string | null };
  frame: string;
  /** Key into `prompts`; the text is there, once. */
  promptKey: string;
  status: string;
  truncated: boolean;
  stopReason: string | null;
  modelRequested: string | null;
  modelResolved: string | null;
  cliVersion: string | null;
  /** `effort` is null when the run passed none and the CLI used its default for the model. */
  sandbox: { image: string; digest: string | null; effort: string | null } | null;
  account: string | null;
  envClean: boolean | null;
  durationMs: number | null;
  ranAt: string;
  reach: string | null;
  adopted: string | null;
  platformsNamed: string[];
  decisionMode: string | null;
  adoptionSource: string | null;
  adoptionEvidence: string[];
  adoptionConflict: string | null;
  changedFiles: string[];
  searchQueries: string[];
  pagesOpened: { url: string; host: string | null; kind: string; rank: number | null }[];
  toolErrors: number;
  /**
   * Every tool call in order, redacted like the closing message. Schema 2 published a count,
   * which left "decided from prior knowledge" unprovable from the record: a reader could not
   * see that a run read nothing, and could not see the runs that read vendor docs with curl.
   */
  toolTimeline: { seq: number; tool: string; detail?: string }[];
  needsReview: boolean;
  reviewNote: string | null;
  reviewedAt: string | null;
  closingMessage: string | null;
};

export type WaveDataset = {
  schema: typeof DATASET_SCHEMA;
  generatedAt: string;
  graderVersion: string;
  /**
   * How many closing messages had something taken out of them, and by which rule. A
   * publish that redacts nothing and a publish that redacts four are different events, and
   * a reader comparing this record against a run they can see needs to know which.
   */
  redacted: { rule: string; closingMessages: number; toolCalls: number };
  wave: { id: number; name: string; file: string; startedAt: string | null; finishedAt: string | null };
  surface: { key: string; label: string };
  design: {
    repositories: { id: string; repoUrl: string | null; baseSha: string | null }[];
    frames: string[];
    reps: number;
    planned: number;
  };
  prompts: Record<string, { frame: string; text: string }>;
  /**
   * The vocabulary `named` and the pages-per-platform counts were computed with. Without it
   * a reload has to guess at the spellings, and on season 0 the guess read Cloudflare as
   * named in 20 runs against a published 50 ("Workers" and "Pages" are Cloudflare's). A
   * figure the record cannot reproduce is a figure the reader has to take on trust.
   */
  platforms: DatasetPlatform[];
  provenance: {
    accounts: string[];
    clean: boolean | null;
    modelRequested: string | null;
    modelsServed: { model: string; runs: number }[];
    drift: number;
    cliVersions: string[];
    images: string[];
    /** The effort runs were given, counted; null is "not passed, the CLI's default for the model". */
    efforts: { effort: string | null; runs: number }[];
    firstRunAt: string | null;
    lastRunAt: string | null;
    durationMedianMs: number | null;
    durationMinMs: number | null;
    durationMaxMs: number | null;
  };
  totals: {
    runs: number; gradeable: number; voided: number; errored: number; ungraded: number;
    undecided: number; needsReview: number; searched: number; fetched: number; pagesOpened: number;
  };
  adoption: { platform: string; listed: boolean; adopted: number; share: number; named: number; presence: number; ci: Interval | null }[];
  byFrame: { frame: string; promptKey: string; gradeable: number; adopted: { platform: string; n: number }[]; undecided: number }[];
  stability: Stability;
  claims: Claim[];
  runs: DatasetRun[];
};

export type DatasetMeta = {
  wave: { id: number; name: string; startedAt: number | null; finishedAt: number | null };
  waveFile: string;
  graderVersion: string;
  generatedAt: string;
  /** The platforms the benchmark was computed against, aliases and domains included. */
  platforms: Alias[];
};

const iso = (s: number | null | undefined): string | null => (typeof s === "number" ? new Date(s * 1000).toISOString() : null);

export function datasetRun(r: AgentRow): DatasetRun {
  return {
    runId: r.runId,
    cellId: r.cellId,
    rep: r.rep,
    repository: { id: r.target, repoUrl: r.repoUrl, baseSha: r.baseSha },
    frame: r.frame,
    promptKey: r.promptKey,
    status: r.status,
    truncated: r.truncated,
    stopReason: r.stopReason,
    modelRequested: r.modelRequested,
    modelResolved: r.modelResolved,
    cliVersion: r.toolVersion,
    sandbox: r.sandbox ? { image: r.sandbox.image, digest: r.sandbox.digest, effort: r.sandbox.effort ?? null } : null,
    account: r.account,
    envClean: r.envClean,
    durationMs: r.durationMs,
    ranAt: iso(r.ranAt) ?? "",
    reach: r.reach,
    adopted: r.adopted,
    platformsNamed: r.platformsNamed ?? [],
    decisionMode: r.decisionMode,
    adoptionSource: r.adoptionSource,
    adoptionEvidence: r.adoptionEvidence,
    adoptionConflict: r.adoptionConflict,
    changedFiles: r.changedFiles,
    searchQueries: r.searchQueries,
    pagesOpened: r.sources.map((s) => ({ url: s.url, host: s.host, kind: s.kind, rank: s.rank })),
    toolErrors: r.toolErrors.length,
    toolTimeline: r.toolTimeline.map((e) => ({ seq: e.seq, tool: e.tool, ...(e.detail ? { detail: redact(e.detail).text } : {}) })),
    needsReview: r.needsReview ?? false,
    reviewNote: r.reviewNote,
    reviewedAt: iso(r.reviewedAt),
    closingMessage: redact(r.text).text,
  };
}

export function waveDataset(b: AgentBenchmark, rows: AgentRow[], meta: DatasetMeta): WaveDataset {
  const p = b.provenance;
  const published = [...rows]
    .sort((x, y) => x.cellId - y.cellId || x.rep - y.rep || x.runId - y.runId)
    .map(datasetRun);
  // Counted off the published text rather than recomputed, so the number cannot drift from
  // what the file actually carries.
  const redactedMessages = published.filter((r) => r.closingMessage?.includes(REDACTED)).length;
  const redactedCalls = published.reduce((n, r) => n + r.toolTimeline.filter((e) => e.detail?.includes(REDACTED)).length, 0);
  const prompts: WaveDataset["prompts"] = {};
  for (const f of b.byFrame) prompts[f.promptKey] = { frame: f.frame, text: f.promptText };
  // A row whose prompt the frame cut did not carry (it cannot happen, but the map is
  // what the runs point into, so it is closed over the rows rather than trusted).
  for (const r of rows) if (!(r.promptKey in prompts)) prompts[r.promptKey] = { frame: r.frame, text: r.promptText };

  return {
    schema: DATASET_SCHEMA,
    generatedAt: meta.generatedAt,
    graderVersion: meta.graderVersion,
    redacted: { rule: REDACTION_RULE, closingMessages: redactedMessages, toolCalls: redactedCalls },
    wave: {
      id: meta.wave.id,
      name: meta.wave.name,
      file: meta.waveFile,
      startedAt: iso(meta.wave.startedAt),
      finishedAt: iso(meta.wave.finishedAt),
    },
    surface: { key: b.surfaceKey, label: b.surfaceLabel },
    design: {
      repositories: b.byRepository.map((r) => ({ id: r.target, repoUrl: r.repoUrl, baseSha: r.baseSha })),
      frames: b.frames,
      reps: b.reps,
      planned: b.repositories.length * b.frames.length * b.reps,
    },
    prompts,
    platforms: meta.platforms
      .map((a) => ({ name: a.name, aliases: [...a.aliases], domains: [...(a.domains ?? [])], caseSensitive: Boolean(a.caseSensitive) }))
      .sort((x, y) => x.name.localeCompare(y.name)),
    provenance: {
      accounts: p.accounts,
      clean: p.clean,
      modelRequested: p.modelRequested,
      modelsServed: p.modelsServed,
      drift: p.drift,
      cliVersions: p.cliVersions,
      images: p.images,
      efforts: p.efforts,
      firstRunAt: iso(p.firstRunAt),
      lastRunAt: iso(p.lastRunAt),
      durationMedianMs: p.durationMedianMs,
      durationMinMs: p.durationMinMs,
      durationMaxMs: p.durationMaxMs,
    },
    totals: {
      runs: b.runs, gradeable: b.gradeable, voided: b.voided, errored: b.errored, ungraded: b.ungraded,
      undecided: b.undecided, needsReview: b.needsReview, searched: b.searched, fetched: b.fetched, pagesOpened: b.pagesOpened,
    },
    adoption: b.adoption.map((a) => ({
      platform: a.platform, listed: a.listed, adopted: a.adopted, share: a.share, named: a.named, presence: a.presence, ci: a.ci ?? null,
    })),
    byFrame: b.byFrame.map((f) => ({ frame: f.frame, promptKey: f.promptKey, gradeable: f.gradeable, adopted: f.adopted, undecided: f.undecided })),
    stability: {
      comparable: b.stability.comparable,
      flipped: b.stability.flipped,
      flipRate: b.stability.flipRate,
      examples: b.stability.examples,
    },
    claims: agentClaims(b, meta.wave.id),
    runs: published,
  };
}
