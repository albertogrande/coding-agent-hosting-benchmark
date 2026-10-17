/**
 * The measurement schema.
 *
 * Shaped by eleven defects found in the AEO repo's v6 chat arm and agent arm, each of
 * which survived because nothing in the pipeline could see it. The comments below name
 * the defect a column exists to prevent; they are not decoration. See the plan's Part 2.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

/**
 * An alias list for one platform. The grader matches on these, case-sensitively where asked.
 *
 * `domains` is what the platform *owns*, and is a different question from `aliases`, which
 * is what naming it in prose looks like. "Render" is an alias; `render.com` is a domain; and
 * a citation's owner cannot be read off the alias list, because half of them are English
 * words. Empty means this platform owns nothing yet, so its pages classify as third-party —
 * unattributed rather than misattributed.
 */
export type Alias = { name: string; aliases: string[]; domains?: string[]; caseSensitive?: boolean };
/** A site to audit. `docs` is separate because llms.txt lives on either and rarely both. */
export type Domain = { label: string; site: string; docs?: string };
export type Category = { key: string; label: string; rank: number };
/** One tool call, in the order it happened. `detail` is the query, URL or path. */
export type ToolEvent = { seq: number; tool: string; detail?: string };
/**
 * The account a wave ran on, read once at launch. Lives here rather than in the runner
 * because both the runner that writes it and the reports that filter on it need the shape.
 */
export type EnvStamp = { account: string; clean: boolean; issues: string[] };

// ---------------------------------------------------------------- project

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /**
   * A focal platform, when the project has one, plus every string that counts as naming it.
   *
   * Null for a category benchmark, which is what the hosting season is. The rungs of the
   * stance ladder are about one platform, so the focal row is chosen while *reading* —
   * `stanceFor` in `src/derive/funnel.ts` derives it from what each run named and adopted —
   * and no name is written here as the subject of the study. The column stays because the
   * app is also usable by a company measuring itself, and that project does have a subject.
   */
  brand: text("brand", { mode: "json" }).$type<Alias>(),
  /** The platforms being measured. With no focal row, they are the whole field. */
  competitors: text("competitors", { mode: "json" }).$type<Alias[]>().notNull(),
  /**
   * Sites for the technical audit — every platform being compared, rivals included, since
   * the audit's whole point is the comparison. Never an ownership list: reading a cited
   * page's owner off this would file every competitor's docs under the brand. Ownership
   * lives on `Alias.domains`, per platform.
   */
  domains: text("domains", { mode: "json" }).$type<Domain[]>().notNull().default(sql`'[]'`),
  /** Declared in rank order so a report never falls back to alphabetical. */
  categories: text("categories", { mode: "json" }).$type<Category[]>().notNull().default(sql`'[]'`),
  createdAt: integer("created_at").notNull().default(now),
});

// ---------------------------------------------------------------- prompts

/**
 * A prompt set is a design document, not a list. `design` carries the decisions and the
 * factors — including what was deliberately excluded and why — because a set that cannot
 * say why it omits a prompt shape cannot defend the numbers it produces.
 */
export const promptSets = sqliteTable("prompt_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  name: text("name").notNull(),
  design: text("design", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  supersedesId: integer("supersedes_id"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => [uniqueIndex("prompt_sets_project_version").on(t.projectId, t.version)]);

export const prompts = sqliteTable("prompts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  setId: integer("set_id").notNull().references(() => promptSets.id, { onDelete: "cascade" }),
  /** Stable within a set, so the same prompt is traceable across waves. */
  key: text("key").notNull(),
  category: text("category"),
  topic: text("topic"),
  /** recommendation | comparison | evaluative | howto — what the asker wants back. */
  intent: text("intent"),
  /** short | scenario — nominal query vs situational phrasing. A measured factor. */
  shape: text("shape"),
  text: text("text").notNull(),
  /**
   * A branded prompt names the brand, so a mention is guaranteed by construction: it
   * measures whether the docs are good enough to build with, never whether the brand is
   * reached for. Never pooled with unbranded rates.
   */
  branded: integer("branded", { mode: "boolean" }).notNull().default(false),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  /** manual | imported | generated — provenance for when the demand generator lands. */
  source: text("source").notNull().default("manual"),
  /** The page that would satisfy this prompt, for pre/post measurement after it ships. */
  gapTarget: text("gap_target"),
}, (t) => [uniqueIndex("prompts_set_key").on(t.setId, t.key)]);

// ---------------------------------------------------------------- waves

export const waves = sqliteTable("waves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  promptSetId: integer("prompt_set_id").notNull().references(() => promptSets.id),
  name: text("name").notNull(),
  /** planned | running | paused | complete | aborted */
  status: text("status").notNull().default("planned"),
  /** Hard ceiling in USD. The runner aborts rather than exceeding it. */
  costCapUsd: integer("cost_cap_usd"),
  notes: text("notes"),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  createdAt: integer("created_at").notNull().default(now),
});

/**
 * One measurement instrument inside a wave: which surface, which model, under what
 * settings. Config is snapshotted here rather than read live, so a wave stays
 * interpretable after the project's defaults move (defect 8).
 */
export const waveSurfaces = sqliteTable("wave_surfaces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  waveId: integer("wave_id").notNull().references(() => waves.id, { onDelete: "cascade" }),
  /** e.g. chat.api.anthropic, chat.cli.claude, agent.repo. Identifies the adapter. */
  surfaceKey: text("surface_key").notNull(),
  /** Display label for reports: "Claude (Sonnet 5)". */
  label: text("label").notNull(),
  modelRequested: text("model_requested"),
  reps: integer("reps").notNull().default(1),
  /** searchEnabled, maxOutputTokens, temperature, timeouts — whatever the adapter reads. */
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
}, (t) => [uniqueIndex("wave_surfaces_unique").on(t.waveId, t.surfaceKey, t.label)]);

/**
 * The unit of balance: one prompt on one surface, with the number of repeats it is
 * *supposed* to have. Planned-vs-actual is then a subtraction, which is how an
 * unbalanced wave gets caught before analysis rather than nine months after (defect 5,
 * and the 519-vs-460 incident that preceded it).
 */
export const cells = sqliteTable("cells", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  waveId: integer("wave_id").notNull().references(() => waves.id, { onDelete: "cascade" }),
  promptId: integer("prompt_id").notNull().references(() => prompts.id),
  waveSurfaceId: integer("wave_surface_id").notNull().references(() => waveSurfaces.id, { onDelete: "cascade" }),
  /**
   * What this cell runs the prompt against — a repository, for the agent surfaces.
   * Empty for chat, where the prompt is the whole subject.
   *
   * A column rather than a second cell table, so balance checking, resume and the flip
   * rate keep working untouched. It also makes a crossed plan the default: the original
   * agent arm was two disjoint blocks (4 repos x P1-P3, 3 repos x P4-P6) presented as
   * "7 repos x 3 prompts", which left the prompt's framing perfectly confounded with the
   * repository. Here the cross product is what gets planned, and any deliberate hole
   * shows up on the balance card instead of hiding in the design.
   */
  target: text("target").notNull().default(""),
  plannedReps: integer("planned_reps").notNull(),
}, (t) => [uniqueIndex("cells_unique").on(t.waveId, t.promptId, t.waveSurfaceId, t.target)]);

// ---------------------------------------------------------------- runs

export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cellId: integer("cell_id").notNull().references(() => cells.id, { onDelete: "cascade" }),
  rep: integer("rep").notNull(),
  /** ok | error | voided — voided means the instrument failed, not the brand. */
  status: text("status").notNull().default("ok"),
  /** What the provider actually served, which can differ from what was requested. */
  modelResolved: text("model_resolved"),
  /**
   * The CLI or SDK release that produced the run. The other half of "what answered": the
   * same model under a different Claude Code release has a different system prompt and
   * tool stack, and a wave that cannot name its release cannot be compared with the next.
   */
  toolVersion: text("tool_version"),
  /**
   * The provider's response, verbatim. This is the single most important column here:
   * the v6 arm stored only extracted text, so a citation extractor that dropped sources
   * on 149 of 150 Claude runs could never be fixed without paying for the wave again
   * (defect 2). With this, every parser is re-runnable over history.
   */
  rawResponse: text("raw_response"),
  text: text("text"),
  /** end_turn | max_tokens | stop_sequence | ... — provider verbatim. */
  stopReason: text("stop_reason"),
  /**
   * Hit the output ceiling. The grader refuses to grade these: in the v6 arm, 46% of
   * Claude's scenario runs were cut off mid-sentence and 12 produced no text at all
   * after running up to 27 searches — all scored `absent`, as if the brand had lost
   * (defect 1).
   */
  truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
  searchCount: integer("search_count"),
  /**
   * What searchCount counts, because providers disagree: OpenAI emits one
   * `web_search_call` per call, Anthropic reports `server_tool_use.web_search_requests`.
   * The v6 arm put both in one column and compared them (defect 4).
   */
  searchUnit: text("search_unit"),
  /**
   * The queries the engine actually ran, verbatim and in order.
   *
   * Extracted by every adapter and, until now, thrown away — the same shape of loss that
   * made the imported wave's citations unrecoverable. What the engine searched for is how
   * a prompt gets rewritten on its way to an answer, and it cannot be reconstructed from
   * the answer text afterwards.
   */
  searchQueries: text("search_queries", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  /**
   * Server-tool failures, which arrive as HTTP 200 with an error object rather than as an
   * exception. A run whose search silently failed still returns prose, and grading it as a
   * measurement of the brand rather than of a broken tool call is exactly the confusion
   * this column exists to prevent.
   */
  toolErrors: text("tool_errors", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  /**
   * The ordered tool calls an agent made: searched, read that page, wrote this file. The
   * evidence behind every adoption verdict, and the thing a transcript is kept for.
   */
  toolTimeline: text("tool_timeline", { mode: "json" }).$type<ToolEvent[]>().notNull().default(sql`'[]'`),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: integer("cost_usd_micros"),
  durationMs: integer("duration_ms"),
  error: text("error"),
  /**
   * The account this run was produced on, `user@host`, and whether that account was clean
   * when the wave was launched.
   *
   * A wave is measurement only if the machine could not tilt it. Two cells in the original
   * agent wave chose Railway because a `~/.railway` token happened to be on the laptop, and
   * a personal global CLAUDE.md or a user-scope MCP server reaches every cell the same way.
   * The preflight can say so before a night starts, but it is advisory and `run-wave` never
   * calls it, so the verdict is taken at launch and carried here instead. Null means the run
   * predates the stamp or was imported; only `false` is a reason to drop a row.
   */
  account: text("account"),
  envClean: integer("env_clean", { mode: "boolean" }),
  /** The failed preflight check names, so a rejected row explains itself. */
  envIssues: text("env_issues", { mode: "json" }).$type<string[]>(),
  ranAt: integer("ran_at").notNull().default(now),
  /** Set when a run came from another wave or an external dataset (defect 8). */
  importedFrom: text("imported_from"),
}, (t) => [
  uniqueIndex("runs_cell_rep").on(t.cellId, t.rep),
  index("runs_cell").on(t.cellId),
]);

/**
 * One page a run read. `kind` distinguishes a citation attached to the answer from a
 * raw search result from a page actually fetched — the distinction that decides whether
 * "the agent never opened a page" is a finding or an instrumentation gap (defect 3).
 */
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  host: text("host"),
  title: text("title"),
  rank: integer("rank"),
  /** citation | search_result | fetch */
  kind: text("kind").notNull().default("citation"),
}, (t) => [index("sources_run").on(t.runId)]);

// ---------------------------------------------------------------- grading

/**
 * Grades reference a run id, not a tuple of facets. The v6 arm joined its stance file to
 * its runs file on (category, topic, shape, engine, rep) with no prompt column — one
 * duplicated topic-shape pair away from silently attaching the wrong grade to an answer
 * (defect 9).
 */
export const grades = sqliteTable("grades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  /** Bumped whenever the heuristics change, so a re-grade is a diff, not an overwrite. */
  graderVersion: text("grader_version").notNull(),
  /** absent | mentioned | shortlisted | recommended | voided */
  stance: text("stance").notNull(),
  /** The brand's position among platforms named, by first appearance. Null if absent. */
  brandRank: integer("brand_rank"),
  /** Which platform the answer actually picked, if it picked one. */
  winner: text("winner"),
  platformsNamed: text("platforms_named", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  /** A hedge or negative attached to the brand — "great DX, but check reliability". */
  caveat: integer("caveat", { mode: "boolean" }).notNull().default(false),
  /** The sentence the label came from, so every grade is checkable by hand. */
  evidence: text("evidence"),
  /**
   * prior | search | fetch — was the pick made from the model's weights, from a search
   * result, or from a page it opened? Gauge's best column, generalised to chat.
   */
  decisionMode: text("decision_mode"),
  /** Unresolved is a visible state with a count, never a silent exclusion (defect 6). */
  needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
  reviewNote: text("review_note"),
  reviewedAt: integer("reviewed_at"),
  gradedAt: integer("graded_at").notNull().default(now),
}, (t) => [uniqueIndex("grades_run_version").on(t.runId, t.graderVersion)]);

// ---------------------------------------------------------------- technical audit

export const auditRuns = sqliteTable("audit_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ranAt: integer("ran_at").notNull().default(now),
  /** The domain list as it stood, so an old audit stays readable after the list moves. */
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
});

export const auditFindings = sqliteTable("audit_findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  auditRunId: integer("audit_run_id").notNull().references(() => auditRuns.id, { onDelete: "cascade" }),
  /** The domain label this finding belongs to. */
  target: text("target").notNull(),
  /** llms_txt | llms_full_txt | robots_bot | sitemap | json_ld */
  check: text("check").notNull(),
  /** A sub-key: the bot name for robots_bot, the file for llms_*, empty otherwise. */
  subject: text("subject").notNull().default(""),
  /** pass | fail | warn | info — the only four a report needs to colour. */
  status: text("status").notNull(),
  summary: text("summary").notNull(),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
}, (t) => [index("audit_findings_run").on(t.auditRunId)]);
