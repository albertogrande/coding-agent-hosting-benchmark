/**
 * Reads a published wave dataset back into the shape the store expects.
 *
 * This exists because the report advertises a reproduce path that did not work. The page
 * tells a reader to download the dataset, run `npm run grade` and re-derive every figure in
 * minutes with no login — the one thing a hosted dashboard cannot offer. But `grade` reads
 * SQLite, `data/*.db` is gitignored, and nothing in the tree read `data/published/` except
 * the writer that produced it. From a clean clone the fast path was prose.
 *
 * Pure, and separate from the script that writes: the mapping from a published row to a
 * stored one is the part worth testing, and a test should not need a database on disk to
 * check it. `scripts/load-published.mts` is the thin writer over this.
 *
 * What cannot come back matters as much as what can, so it is enumerated rather than
 * discovered later. A published record is deliberately not a transcript archive: the raw
 * provider response, the ordered tool timeline and the tool errors are stored as *counts*,
 * and token counts and cost are absent. Grading never reads any of them — it reads the
 * closing text and the changed files, both published whole but for a redacted credential
 * or address — so a re-grade is faithful while a re-render of the tool timeline is not; a
 * test holds the grader to that, since a redaction that ate a platform name would move a
 * published figure. `losses` says which, and the loader prints
 * it, because a store that looks complete and is not is worse than one that says so.
 */
import { REDACTED, REDACTION_RULE } from "../lib/redact";

/** One run as `data/published/<wave>.json` stores it. Only the fields the store needs. */
export type PublishedRun = {
  runId: number;
  cellId: number;
  rep: number;
  repository: { id: string; repoUrl?: string | null; baseSha?: string | null };
  frame: string;
  promptKey: string;
  status: string;
  truncated: boolean;
  stopReason: string | null;
  modelRequested: string | null;
  modelResolved: string | null;
  cliVersion: string | null;
  sandbox: { image?: string | null; digest?: string | null; effort?: string | null } | null;
  account: string | null;
  envClean: boolean | null;
  durationMs: number | null;
  ranAt: number | string | null;
  adopted: string | null;
  reach: string | null;
  platformsNamed: string[];
  decisionMode: string | null;
  adoptionSource: string | null;
  adoptionEvidence: string[];
  adoptionConflict: string | null;
  changedFiles: string[];
  searchQueries: string[];
  pagesOpened: { url: string; host?: string | null; kind?: string | null; rank?: number | null }[];
  toolErrors?: number | string[];
  toolTimeline?: number | unknown[];
  needsReview: boolean;
  reviewNote: string | null;
  reviewedAt: number | string | null;
  closingMessage: string | null;
};

export type PublishedPlatform = { name: string; aliases: string[]; domains?: string[]; caseSensitive?: boolean };

export type PublishedDataset = {
  schema: string;
  graderVersion: string;
  redacted?: { rule: string; closingMessages: number; toolCalls?: number };
  wave: { id: number; name: string; file?: string; startedAt?: unknown; finishedAt?: unknown };
  surface: { key: string; label: string };
  design: {
    repositories: { id: string; repoUrl?: string; baseSha?: string }[];
    frames?: string[];
    reps: number;
    planned: number;
  };
  prompts: Record<string, { frame: string; text: string }>;
  /** Version 2 and later: the recogniser vocabulary the `named` counts were computed with. */
  platforms?: PublishedPlatform[];
  provenance?: { modelRequested?: string | null };
  totals?: Record<string, number>;
  runs: PublishedRun[];
};

/** The schema versions this loader understands. A newer one is refused, not guessed at. */
export const SUPPORTED_SCHEMAS = ["aeo-tool/wave-dataset/1", "aeo-tool/wave-dataset/2", "aeo-tool/wave-dataset/3"];

/** From version 2 a dataset carries its alias lists, and one that does not is refused. */
const CARRIES_PLATFORMS = new Set(["aeo-tool/wave-dataset/2", "aeo-tool/wave-dataset/3"]);

export type LoadPlan = {
  waveName: string;
  graderVersion: string;
  surface: { key: string; label: string; modelRequested: string | null; reps: number };
  targets: { id: string }[];
  prompts: { key: string; text: string; shape: string }[];
  runs: PublishedRun[];
  /** The published vocabulary, or null when the record predates it and the loader must guess. */
  platforms: PublishedPlatform[] | null;
  /** Everything the published record cannot restore, named so the caller can print it. */
  losses: string[];
};

/** Milliseconds since the epoch, from either an ISO string or an epoch number. */
export function epoch(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * A count is not a list. `toolTimeline: 41` says the run made 41 tool calls and nothing
 * about what they were, so the array is restored empty and the loss is recorded — rather
 * than fabricating 41 placeholder events, which would render a timeline of nothing in the
 * explorer and read as data.
 */
const isCount = (v: unknown): v is number => typeof v === "number";

export function planLoad(data: PublishedDataset): LoadPlan {
  if (!SUPPORTED_SCHEMAS.includes(data.schema)) {
    throw new Error(
      `dataset schema '${data.schema}' is not one this loader understands ` +
      `(${SUPPORTED_SCHEMAS.join(", ")}). Refusing to guess at the mapping.`,
    );
  }
  if (!data.runs?.length) throw new Error("dataset has no runs");
  const platforms = data.platforms?.length ? data.platforms : null;
  if (CARRIES_PLATFORMS.has(data.schema) && !platforms) {
    throw new Error(
      `dataset schema '${data.schema}' publishes its platform alias lists and this file has none. ` +
      "Loading it would guess at the spellings and change every `named` count.",
    );
  }

  const planned = data.design.planned;
  if (planned && data.runs.length > planned) {
    throw new Error(`dataset holds ${data.runs.length} runs for a design that planned ${planned}`);
  }

  // Prompts come from the dataset's own prompt map, keyed exactly as the runs reference
  // them. `shape` is the frame: it is what `agentRunRows` reads back as a run's frame, so
  // getting it from anywhere else would silently re-bucket every run.
  const prompts = Object.entries(data.prompts).map(([key, p]) => ({
    key,
    text: p.text,
    shape: p.frame,
  }));
  const referenced = new Set(data.runs.map((r) => r.promptKey));
  const missing = [...referenced].filter((k) => !data.prompts[k]);
  if (missing.length) {
    throw new Error(`runs reference prompts the dataset does not carry: ${missing.join(", ")}`);
  }

  // Targets are the repositories, in the design's declared order rather than the order the
  // shuffled runs happen to mention them in.
  const targets = data.design.repositories.map((r) => ({ id: r.id }));
  const declared = new Set(targets.map((t) => t.id));
  const strays = [...new Set(data.runs.map((r) => r.repository.id))].filter((id) => !declared.has(id));
  if (strays.length) {
    throw new Error(`runs name repositories the design does not list: ${strays.join(", ")}`);
  }

  const losses = ["the raw provider response and the full transcript (never published)"];
  if (data.runs.some((r) => isCount(r.toolTimeline))) {
    losses.push("the ordered tool timeline — published as a count, so it restores empty");
  }
  if (data.runs.some((r) => isCount(r.toolErrors))) {
    losses.push("tool errors — published as a count, so they restore empty");
  }
  losses.push("input/output tokens and cost (absent from the published record)");
  /**
   * The one loss that changes a published figure rather than a detail. `named` counts how
   * many runs mentioned a platform, and that comes from matching the project's alias list
   * against each run's text — "Workers" and "Pages" for Cloudflare, "Fly" for Fly.io. The
   * alias lists are not in the dataset, so a reload seeds them from the recogniser's own
   * spellings and the counts come back close but not equal: on wave 3, Cloudflare reads 20
   * against a published 50 and Fly.io 79 against 89. Adoption counts are unaffected — they
   * come from the stored grade — but "named against chosen" must be read off the published
   * record, never off a reloaded one.
   */
  if (!platforms) {
    losses.push(
      "the project's platform alias lists, so `named` counts differ after a reload — " +
      "read named-against-chosen off the published record, not a rebuilt store",
    );
  }
  /**
   * Not a gap in the record but a deliberate hole in it, and the loader says so for the
   * same reason it names the others: a reader who re-grades this store and then reads a
   * run should know why a password is missing rather than wonder what else is.
   */
  const redactedMessages = data.runs.filter((r) => r.closingMessage?.includes(REDACTED)).length;
  if (redactedMessages) {
    losses.push(
      `the redacted spans in ${redactedMessages} closing message(s) — ${data.redacted?.rule ?? REDACTION_RULE}; ` +
      "deliberate, and the grader reads none of it",
    );
  }

  return {
    waveName: data.wave.name,
    graderVersion: data.graderVersion,
    surface: {
      key: data.surface.key,
      label: data.surface.label,
      modelRequested: data.provenance?.modelRequested ?? data.runs[0]?.modelRequested ?? null,
      reps: data.design.reps,
    },
    targets,
    prompts,
    runs: data.runs,
    platforms,
    losses,
  };
}

/**
 * The `rawResponse` blob, rebuilt.
 *
 * `agentRunRows` reads the agent-specific half of a run out of this JSON rather than out of
 * columns — changed files, the repo and its base commit, the sandbox stamp, and what the
 * adoption ladder saw. All four are published as top-level fields, so the blob round-trips
 * even though the transcript it originally sat beside does not.
 */
export function rawFor(run: PublishedRun): Record<string, unknown> {
  return {
    changedFiles: run.changedFiles ?? [],
    repoUrl: run.repository.repoUrl ?? null,
    baseSha: run.repository.baseSha ?? null,
    sandbox: run.sandbox?.image
      ? { image: run.sandbox.image, digest: run.sandbox.digest ?? null, cliVersion: run.cliVersion, effort: run.sandbox.effort ?? null }
      : null,
    // The pages the run fetched, which the grader reads to tell a decision from memory from one
    // made after reading. Without them a re-grade called 34 of 132 season 1 runs differently.
    fetches: (run.pagesOpened ?? []).filter((p) => (p.kind ?? "fetch") === "fetch").map((p) => p.url),
    adoption: {
      source: run.adoptionSource,
      evidence: run.adoptionEvidence ?? [],
      conflict: run.adoptionConflict,
    },
    // Says where this row came from, inside the row itself, so a loaded store cannot be
    // mistaken for one a wave wrote.
    loadedFromPublished: true,
  };
}

/** The `RunOutcome`-shaped record `recordRun` stores, from a published row. */
export function outcomeFor(run: PublishedRun) {
  return {
    raw: rawFor(run),
    text: run.closingMessage ?? "",
    modelResolved: run.modelResolved,
    toolVersion: run.cliVersion,
    stopReason: run.stopReason,
    truncated: Boolean(run.truncated),
    // Derived from the queries themselves: the count is the length of the list that is
    // published in full, so it is a fact rather than a reconstruction.
    searchCount: run.searchQueries?.length ?? 0,
    searchUnit: "claude_cli.web_search",
    searchQueries: run.searchQueries ?? [],
    toolErrors: Array.isArray(run.toolErrors) ? run.toolErrors : [],
    toolTimeline: Array.isArray(run.toolTimeline) ? run.toolTimeline : [],
    sources: (run.pagesOpened ?? []).map((p) => ({
      url: p.url,
      title: null,
      kind: p.kind ?? "fetch",
      rank: p.rank ?? null,
    })),
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    durationMs: run.durationMs ?? 0,
  };
}

/**
 * The grade to restore, or null when the run carries none.
 *
 * Written at the *dataset's* grader version, never the current one. That is the whole point:
 * the loaded grades are the published verdict, a re-grade writes the current version beside
 * them, and the two versions are then a diff rather than an overwrite. A reviewer's relabel
 * is the part no re-grade can reproduce, so its note and timestamp travel with it.
 */
export function gradeFor(run: PublishedRun) {
  if (!run.reach) return null;
  return {
    stance: run.reach,
    brandRank: null as number | null,
    winner: run.adopted,
    platformsNamed: run.platformsNamed ?? [],
    caveat: false,
    evidence: (run.adoptionEvidence ?? []).join(" · ") || null,
    decisionMode: run.decisionMode,
    needsReview: Boolean(run.needsReview),
    reviewNote: run.reviewNote,
    reviewedAt: epoch(run.reviewedAt),
  };
}
