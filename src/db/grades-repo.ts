/**
 * Grading stored answers, and reading them back with their grades.
 *
 * Grading never calls a provider: it reads the text already stored and derives labels
 * from it. That is what makes re-grading free, and it is why the grader's version is part
 * of the key — changing the rules produces a second set of labels to diff against the
 * first, rather than overwriting history.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { cells, grades, prompts, runs, sources, waveSurfaces } from "./schema";
import { GRADER_VERSION, grade, gradeAgentRun, type Stance } from "@/derive/grade";
import { adoption, decisionMode } from "@/derive/adoption";
import { shellLookups } from "@/derive/shell-lookups";
import type { CitationRow } from "@/derive/citations";
import type { Alias } from "./schema";

export type GradeRow = typeof grades.$inferSelect;

type AgentRunRow = {
  text: string | null;
  rawResponse: string | null;
  searchCount: number | null;
  toolTimeline?: { tool: string; detail?: string }[] | null;
};

/** What the raw record carries, when there is one. */
function rawOf(r: AgentRunRow): Record<string, unknown> {
  if (!r.rawResponse) return {};
  try {
    const v = JSON.parse(r.rawResponse);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Runs the adoption ladder over a stored agent run.
 *
 * The changed-file list comes from the raw record when the run was made by this app, and
 * is simply absent for the imported rows — the original arm's transcripts and clones were
 * gitignored as "reproducible from the harness", which a live model against a live web is
 * not. Those rows fall back to the ladder's final-message tier.
 */
function adoptedOf(r: AgentRunRow): { adopted: string | null; conflict: string | null } {
  const raw = rawOf(r);

  // An imported run carries the verdict its own arm reached, over a transcript this app
  // never had. Trusting it beats re-running the ladder over a summary: the summary lists
  // what the agent *considered*, and reading it as a decision turns "adopted dev-env,
  // considered Railway" into a Railway win.
  const imported = raw.imported as { adopted?: string | null } | undefined;
  if (imported) return { adopted: imported.adopted ?? null, conflict: null };

  const changed = Array.isArray(raw.changedFiles) ? (raw.changedFiles as string[]) : [];
  // The bodies of the files the agent touched, when the runner stored them. Without them
  // the deploy-artifact tier cannot fire, so a run that wrote `gcloud run deploy` into a
  // Makefile and said nothing in its closing text would fall to the review queue.
  const fileBodies = Array.isArray(raw.fileBodies)
    ? (raw.fileBodies as { path: string; body: string }[]).filter((b) => typeof b?.path === "string" && typeof b?.body === "string")
    : undefined;
  const a = adoption({ changedFiles: changed, fileBodies, finalText: r.text ?? "" });
  return { adopted: a.adopted, conflict: a.conflict };
}

function decisionModeOf(r: AgentRunRow): string | undefined {
  const raw = rawOf(r);
  const imported = raw.imported as { searches?: number; fetches?: number } | undefined;
  if (imported) {
    if ((imported.fetches ?? 0) > 0) return "fetch";
    return (imported.searches ?? 0) > 0 ? "search" : "prior";
  }
  const fetches = Array.isArray(raw.fetches) ? raw.fetches.length : undefined;
  if (fetches === undefined && r.searchCount === null) return undefined;
  // What the run read from its shell, from its Bash calls. A loaded published record restores
  // the same timeline, so a re-grade from the record reads the same commands the store had.
  const lookups = shellLookups((r.toolTimeline ?? []).filter((e) => e.tool === "Bash").map((e) => e.detail ?? "")).length;
  return decisionMode({ searches: r.searchCount ?? 0, fetches: fetches ?? 0, shellLookups: lookups });
}

/**
 * Grades every run in a wave that has no grade at this version yet.
 *
 * Idempotent: run it mid-wave, after a wave, or after changing the rules — it only ever
 * adds what is missing at the current version.
 */
/**
 * Grades a wave.
 *
 * `focal` is the platform a *chat* answer is graded about — that arm's whole question is how
 * one platform appears — and is null for a category benchmark, which has no such platform.
 * The agent arm never needed one: it is graded on what the run committed to in code, and the
 * stance ladder for any platform is derived while reading. A wave with chat surfaces and no
 * focal platform is refused rather than graded against an arbitrary row.
 */
export function gradeWave(
  db: Db,
  waveId: number,
  focal: Alias | null,
  platforms: Alias[],
  opts: { regrade?: boolean } = {},
): { graded: number; voided: number; needsReview: number } {
  const rows = db
    .select({
      id: runs.id, text: runs.text, truncated: runs.truncated, status: runs.status,
      rawResponse: runs.rawResponse, searchCount: runs.searchCount, toolTimeline: runs.toolTimeline,
      surfaceKey: waveSurfaces.surfaceKey,
    })
    .from(runs)
    .innerJoin(cells, eq(cells.id, runs.cellId))
    .innerJoin(waveSurfaces, eq(waveSurfaces.id, cells.waveSurfaceId))
    .where(eq(cells.waveId, waveId))
    .all();

  if (opts.regrade && rows.length) {
    db.delete(grades)
      .where(and(inArray(grades.runId, rows.map((r) => r.id)), eq(grades.graderVersion, GRADER_VERSION)))
      .run();
  }

  const already = new Set(
    rows.length
      ? db.select({ runId: grades.runId }).from(grades)
          .where(and(inArray(grades.runId, rows.map((r) => r.id)), eq(grades.graderVersion, GRADER_VERSION)))
          .all().map((g) => g.runId)
      : [],
  );

  const todo = rows.filter((r) => !already.has(r.id));
  if (!todo.length) return { graded: 0, voided: 0, needsReview: 0 };

  const values = todo.map((r) => {
    /**
     * A chat answer is graded on how the brand appears; an agent run is graded on what it
     * committed to in code. Same table, different question — and the pooling rules keep
     * the two from ever being averaged.
     */
    if (!r.surfaceKey.startsWith("agent.") && !focal) {
      throw new Error(
        `run ${r.id} is on a chat surface, which is graded on how one platform appears, and ` +
        `this project names none. Give the project a focal platform, or run agent surfaces only.`,
      );
    }
    const g = r.surfaceKey.startsWith("agent.")
      ? gradeAgentRun({ ...r, ...adoptedOf(r), decisionMode: decisionModeOf(r) }, platforms)
      : grade(r, focal!, platforms.filter((p) => p.name !== focal!.name));
    return {
      runId: r.id, graderVersion: GRADER_VERSION,
      stance: g.stance, brandRank: g.brandRank, winner: g.winner,
      platformsNamed: g.platformsNamed, caveat: g.caveat, evidence: g.evidence,
      decisionMode: g.decisionMode ?? null,
      needsReview: g.needsReview,
    };
  });
  db.insert(grades).values(values).run();

  return {
    graded: values.length,
    voided: values.filter((v) => v.stance === "voided").length,
    needsReview: values.filter((v) => v.needsReview).length,
  };
}

/** A human's call replaces the heuristic's, and clears the review flag. */
export function reviewGrade(db: Db, gradeId: number, stance: Stance, note?: string): void {
  db.update(grades)
    .set({ stance, needsReview: false, reviewNote: note ?? null, reviewedAt: Math.floor(Date.now() / 1000) })
    .where(eq(grades.id, gradeId))
    .run();
}

/**
 * The agent arm's relabel. What a person decides here is *which platform* the run adopted,
 * which is `winner`, not the stance ladder — `reviewGrade` above sets the stance and leaves
 * the winner alone, so on an agent run it cleared the flag without changing the verdict, and
 * the review queue could not actually be resolved. The first season found 32 runs in it.
 *
 * `winner` may be a name outside the catalogue (the report shows it as unlisted) or null,
 * which is the person confirming that the run chose no platform. The note is required: a
 * relabel with no reason is the heuristic wearing a person's name.
 */
export function reviewAdoption(db: Db, gradeId: number, winner: string | null, note: string): void {
  if (!note.trim()) throw new Error("a relabel needs a note saying what was read and why");
  db.update(grades)
    .set({
      winner,
      stance: winner ? "decided" : "considered",
      needsReview: false,
      reviewNote: note,
      reviewedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(grades.id, gradeId))
    .run();
}

export type ExplorerRow = {
  runId: number;
  gradeId: number | null;
  cellId: number;
  rep: number;
  status: string;
  truncated: boolean;
  stopReason: string | null;
  text: string | null;
  promptKey: string;
  promptText: string;
  /** The repository an agent cell ran against, or "" for chat. */
  target: string;
  category: string | null;
  topic: string | null;
  shape: string | null;
  surfaceLabel: string;
  surfaceKey: string;
  stance: string | null;
  winner: string | null;
  brandRank: number | null;
  /** Every platform the answer named, in order of first appearance. Null when ungraded. */
  platformsNamed: string[] | null;
  caveat: boolean | null;
  evidence: string | null;
  needsReview: boolean | null;
  reviewNote: string | null;
  sourceCount: number;
  /** Searches the engine ran. Zero searches with zero sources is silence, not a fault. */
  searchCount: number | null;
  /** `user@host` the run was produced on. Null for imported and pre-stamp rows. */
  account: string | null;
  /**
   * Whether that account was clean when the wave launched. Null is "not known", which is
   * how every imported row arrives; only `false` says the machine could have tilted it.
   */
  envClean: boolean | null;
};

/** Every run in a wave with its grade, ready for the explorer table. */
export function explorerRows(db: Db, waveId: number): ExplorerRow[] {
  const sc = db.select({ runId: sources.runId, n: sql<number>`count(*)`.as("n") })
    .from(sources).groupBy(sources.runId).as("sc");

  return db
    .select({
      runId: runs.id, gradeId: grades.id, cellId: cells.id, rep: runs.rep,
      status: runs.status, truncated: runs.truncated, stopReason: runs.stopReason, text: runs.text,
      promptKey: prompts.key, promptText: prompts.text, target: cells.target,
      category: prompts.category, topic: prompts.topic, shape: prompts.shape,
      surfaceLabel: waveSurfaces.label, surfaceKey: waveSurfaces.surfaceKey,
      stance: grades.stance, winner: grades.winner, brandRank: grades.brandRank,
      platformsNamed: grades.platformsNamed,
      caveat: grades.caveat, evidence: grades.evidence,
      needsReview: grades.needsReview, reviewNote: grades.reviewNote,
      sourceCount: sql<number>`coalesce(${sc.n}, 0)`,
      searchCount: runs.searchCount,
      account: runs.account,
      envClean: runs.envClean,
    })
    .from(runs)
    .innerJoin(cells, eq(cells.id, runs.cellId))
    .innerJoin(prompts, eq(prompts.id, cells.promptId))
    .innerJoin(waveSurfaces, eq(waveSurfaces.id, cells.waveSurfaceId))
    .leftJoin(grades, and(eq(grades.runId, runs.id), eq(grades.graderVersion, GRADER_VERSION)))
    .leftJoin(sc, eq(sc.runId, runs.id))
    .where(eq(cells.waveId, waveId))
    .orderBy(cells.waveSurfaceId, cells.id, runs.rep)
    .all();
}

export function sourcesFor(db: Db, runId: number) {
  return db.select().from(sources).where(eq(sources.runId, runId)).orderBy(sources.rank).all();
}

/**
 * Every page read in a wave, carrying the prompt that produced it and the stance of the run
 * that read it — the input `src/derive/citations.ts` needs.
 *
 * Separate from `explorerRows` because the grain is different: that one is a row per run,
 * this is a row per page, and joining them would silently multiply every run-level figure
 * by its citation count.
 */
export function sourceRows(db: Db, waveId: number): CitationRow[] {
  return db
    .select({
      runId: runs.id,
      promptKey: prompts.key,
      host: sources.host,
      kind: sources.kind,
      stance: grades.stance,
    })
    .from(sources)
    .innerJoin(runs, eq(runs.id, sources.runId))
    .innerJoin(cells, eq(cells.id, runs.cellId))
    .innerJoin(prompts, eq(prompts.id, cells.promptId))
    .leftJoin(grades, and(eq(grades.runId, runs.id), eq(grades.graderVersion, GRADER_VERSION)))
    .where(eq(cells.waveId, waveId))
    .all();
}
