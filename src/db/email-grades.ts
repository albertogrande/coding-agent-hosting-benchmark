/**
 * Grading and reading back the email project's runs.
 *
 * The same contract as `gradeWave` in `grades-repo.ts`: nothing calls a provider, the labels are
 * derived from what the run stored, and the grader version is part of the key, so a rules change
 * is a second set of grades to diff. The version is the email project's own (`email-1`), never
 * the hosting grader's, so the two projects can share a store without either touching the
 * other's labels.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./client";
import { cells, grades, prompts, runs, waveSurfaces } from "./schema";
import { EMAIL_GRADER_VERSION, gradeEmailRun, type EmailGradeInput } from "@/derive/email/grade";
import type { CompileResult, EgressEntry, FileBody, Manifest } from "@/derive/email/labels";

/** The project slug the email study uses in a store, as `hosting` is the hosting study's. */
export const EMAIL_PROJECT = "email";

export type EmailRunRow = {
  runId: number;
  rep: number;
  status: string;
  truncated: boolean;
  text: string | null;
  rawResponse: string | null;
  toolTimeline: { seq: number; tool: string; detail?: string }[];
  modelResolved: string | null;
  target: string;
  promptKey: string;
  surfaceLabel: string;
  modelRequested: string | null;
  config: Record<string, unknown>;
};

export function emailRunRows(db: Db, waveId: number): EmailRunRow[] {
  return db
    .select({
      runId: runs.id, rep: runs.rep, status: runs.status, truncated: runs.truncated, text: runs.text,
      rawResponse: runs.rawResponse, toolTimeline: runs.toolTimeline, modelResolved: runs.modelResolved,
      target: cells.target, promptKey: prompts.key, surfaceLabel: waveSurfaces.label,
      modelRequested: waveSurfaces.modelRequested, config: waveSurfaces.config,
    })
    .from(runs)
    .innerJoin(cells, eq(cells.id, runs.cellId))
    .innerJoin(prompts, eq(prompts.id, cells.promptId))
    .innerJoin(waveSurfaces, eq(waveSurfaces.id, cells.waveSurfaceId))
    .where(eq(cells.waveId, waveId))
    .orderBy(cells.waveSurfaceId, cells.id, runs.rep)
    .all() as EmailRunRow[];
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** What the labels read, out of a stored row and its raw record. */
export function emailInput(r: EmailRunRow): EmailGradeInput {
  let raw: Record<string, unknown> = {};
  try { raw = r.rawResponse ? JSON.parse(r.rawResponse) : {}; } catch { /* unreadable raw: the labels read what is left */ }
  return {
    target: r.target,
    promptKey: r.promptKey,
    text: r.text,
    stdout: typeof raw.stdout === "string" ? raw.stdout : null,
    toolTimeline: r.toolTimeline ?? [],
    changedFiles: arr<string>(raw.changedFiles),
    fileBodies: arr<FileBody>(raw.fileBodies).filter((b) => typeof b?.path === "string" && typeof b?.body === "string"),
    manifests: arr<Manifest>(raw.manifests),
    ...(Array.isArray(raw.egress) ? { egress: raw.egress as EgressEntry[] } : {}),
    compile: (raw.compile as CompileResult | undefined) ?? null,
    truncated: r.truncated,
    status: r.status,
  };
}

/** The network condition a surface ran under: its egress policy, or `open` with no proxy at all. */
export function conditionOf(config: Record<string, unknown>): string {
  const n = (config.sandbox as { network?: unknown } | undefined)?.network;
  return typeof n === "string" ? n : "open (no proxy)";
}

/** Grades every run of an email wave that has no grade at `email-1` yet. */
export function gradeEmailWave(
  db: Db,
  waveId: number,
  opts: { regrade?: boolean; costAccept?: number[] } = {},
): { graded: number; voided: number; needsReview: number } {
  const rows = emailRunRows(db, waveId);
  const ids = rows.map((r) => r.runId);
  const atVersion = and(inArray(grades.runId, ids), eq(grades.graderVersion, EMAIL_GRADER_VERSION));
  if (opts.regrade && ids.length) db.delete(grades).where(atVersion).run();
  const already = new Set(ids.length ? db.select({ runId: grades.runId }).from(grades).where(atVersion).all().map((g) => g.runId) : []);
  const todo = rows.filter((r) => !already.has(r.runId));
  if (!todo.length) return { graded: 0, voided: 0, needsReview: 0 };

  const values = todo.map((r) => {
    const { grade: g } = gradeEmailRun(emailInput(r), { costAccept: opts.costAccept });
    return {
      runId: r.runId, graderVersion: EMAIL_GRADER_VERSION,
      stance: g.stance, brandRank: g.brandRank, winner: g.winner,
      platformsNamed: g.platformsNamed, caveat: g.caveat, evidence: g.evidence,
      decisionMode: g.decisionMode ?? null, needsReview: g.needsReview,
    };
  });
  db.insert(grades).values(values).run();
  return {
    graded: values.length,
    voided: values.filter((v) => v.stance === "voided").length,
    needsReview: values.filter((v) => v.needsReview).length,
  };
}

/** The stored grade for each run at `email-1`, with any reviewer's call on it. */
export function emailGrades(db: Db, runIds: number[]) {
  if (!runIds.length) return new Map<number, { winner: string | null; needsReview: boolean; reviewNote: string | null }>();
  return new Map(db.select({ runId: grades.runId, winner: grades.winner, needsReview: grades.needsReview, reviewNote: grades.reviewNote })
    .from(grades)
    .where(and(inArray(grades.runId, runIds), eq(grades.graderVersion, EMAIL_GRADER_VERSION)))
    .all().map((g) => [g.runId, g]));
}
