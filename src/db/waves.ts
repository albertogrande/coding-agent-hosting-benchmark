/**
 * Wave storage: planning a wave, finding what is still owed, and recording a run.
 *
 * The important idea here is that a wave is *planned* before it is run. Cells carry the
 * number of repeats they are supposed to have, so "is this wave balanced" is a
 * subtraction rather than an audit — the previous project shipped 519 runs against a
 * designed 460 and every headline number was engine-weighted before anyone noticed.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  cells, grades, promptSets, prompts, runs, sources, waveSurfaces, waves,
  type EnvStamp,
} from "./schema";
import type { ImportedSet } from "@/lib/import-prompts";
import type { RunOutcome } from "@/runner/types";
import { isKnownSurface } from "@/lib/surfaces";

export type Wave = typeof waves.$inferSelect;
export type WaveSurface = typeof waveSurfaces.$inferSelect;
export type Cell = typeof cells.$inferSelect;
export type Run = typeof runs.$inferSelect;

// ---------------------------------------------------------------- prompt sets

export function savePromptSet(db: Db, projectId: number, set: ImportedSet) {
  // Versions are unique per project on purpose: a wave records which set it ran, and two
  // different sets sharing a version would make that record a lie.
  const clash = db.select().from(promptSets)
    .where(and(eq(promptSets.projectId, projectId), eq(promptSets.version, set.version))).get();
  if (clash) {
    throw new Error(
      `this project already has a prompt set at version '${set.version}' ("${clash.name}"). ` +
      `Give the import a new version, or delete the existing set first.`,
    );
  }

  const ps = db.insert(promptSets).values({
    projectId, version: set.version, name: set.name, design: set.design,
  }).returning().get();

  if (set.prompts.length) {
    db.insert(prompts).values(set.prompts.map((p) => ({
      setId: ps.id, key: p.key, text: p.text,
      category: p.category, topic: p.topic, intent: p.intent, shape: p.shape,
      branded: p.branded, tags: p.tags, source: p.source, gapTarget: p.gapTarget,
    }))).run();
  }
  return ps;
}

export function listPromptSets(db: Db, projectId: number) {
  return db.select().from(promptSets).where(eq(promptSets.projectId, projectId)).all();
}

export function promptsIn(db: Db, setId: number) {
  return db.select().from(prompts).where(eq(prompts.setId, setId)).all();
}

// ---------------------------------------------------------------- planning

/**
 * A repository (or other subject) an agent surface runs its prompts against.
 *
 * `sha` pins the commit every cell runs against. A repository is part of the instrument,
 * and one that moves under a season is a design that changed without anyone choosing to.
 */
export type Target = { id: string; url?: string; sha?: string };

export type PlannedSurface = {
  surfaceKey: string;
  label: string;
  modelRequested: string;
  reps: number;
  config: Record<string, unknown>;
  /**
   * Omitted for chat, where the prompt is the whole subject. Given for agent surfaces,
   * where the plan is the cross product of prompts and repositories — every prompt on
   * every target, so no factor can end up confounded with the subject by construction.
   */
  targets?: Target[];
};

export type PlanOptions = {
  /**
   * Permits surfaces with different repeat counts, which is refused by default.
   *
   * Unequal repeats are not always wrong — an agent run costs 20 minutes where a chat run
   * costs seconds, and buying the same n on both may be a bad trade. They are wrong
   * silently: the imported wave gave one engine a 2048-token ceiling and 3 repeats and the
   * other no ceiling and 5, and every comparison drawn from it inherited that. So the
   * asymmetry has to be chosen out loud, and the reason is stored on the wave.
   */
  allowUnequalReps?: string;
};

/**
 * Creates the wave and every cell it owes. Nothing is run here — planning first is what
 * makes the cost estimate honest and the balance check possible.
 */
export function planWave(
  db: Db,
  input: { projectId: number; promptSetId: number; name: string; costCapUsd?: number; surfaces: PlannedSurface[] },
  opts: PlanOptions = {},
): Wave {
  if (!input.surfaces.length) throw new Error("a wave needs at least one surface");
  const promptRows = promptsIn(db, input.promptSetId);
  if (!promptRows.length) throw new Error("that prompt set has no prompts");

  // A typo in a surface key used to survive planning and fail on the first run of the
  // night, after the design was already committed. It fails here instead.
  for (const s of input.surfaces) {
    if (!isKnownSurface(s.surfaceKey)) {
      throw new Error(
        `surface '${s.surfaceKey}' is not a surface this app can run. ` +
        `Check the key against src/lib/surfaces.ts before committing a wave to it.`,
      );
    }
    if (s.reps < 1) throw new Error(`surface ${s.label}: reps must be at least 1`);
  }

  const repCounts = [...new Set(input.surfaces.map((s) => s.reps))];
  if (repCounts.length > 1 && !opts.allowUnequalReps) {
    throw new Error(
      `unequal repeats across surfaces: ${input.surfaces.map((s) => `${s.label} ${s.reps}`).join(", ")}. ` +
      `The wave will be balanced against itself but the surfaces will not carry comparable ` +
      `precision, and that asymmetry is invisible once the numbers exist. ` +
      `Pass allowUnequalReps with the reason if it is deliberate.`,
    );
  }

  const wave = db.insert(waves).values({
    projectId: input.projectId,
    promptSetId: input.promptSetId,
    name: input.name,
    costCapUsd: input.costCapUsd ?? null,
    status: "planned",
    // The reason travels with the wave, so a later reader sees why the design is uneven
    // rather than discovering it in the data.
    notes: opts.allowUnequalReps ? `unequal repeats, deliberately: ${opts.allowUnequalReps}` : null,
  }).returning().get();

  for (const s of input.surfaces) {
    const ws = db.insert(waveSurfaces).values({
      waveId: wave.id,
      surfaceKey: s.surfaceKey,
      label: s.label,
      modelRequested: s.modelRequested,
      reps: s.reps,
      // Targets are snapshotted with the rest of the config: a wave stays readable after
      // the repository list moves under it.
      config: { ...s.config, ...(s.targets?.length ? { targets: s.targets } : {}) },
    }).returning().get();

    const targets = s.targets?.length ? s.targets : [{ id: "" }];
    const rows = promptRows.flatMap((p) =>
      targets.map((t) => ({
        waveId: wave.id, promptId: p.id, waveSurfaceId: ws.id,
        target: t.id, plannedReps: s.reps,
      })),
    );
    db.insert(cells).values(rows).run();
  }
  return wave;
}

export function getWave(db: Db, id: number): Wave | undefined {
  return db.select().from(waves).where(eq(waves.id, id)).get();
}

export function listWaves(db: Db, projectId: number): Wave[] {
  return db.select().from(waves).where(eq(waves.projectId, projectId)).orderBy(sql`${waves.id} desc`).all();
}

export function surfacesOf(db: Db, waveId: number): WaveSurface[] {
  return db.select().from(waveSurfaces).where(eq(waveSurfaces.waveId, waveId)).all();
}

export function setWaveStatus(db: Db, waveId: number, status: string, at?: Partial<Wave>) {
  db.update(waves).set({ status, ...at }).where(eq(waves.id, waveId)).run();
}

// ---------------------------------------------------------------- work queue

export type PendingRun = {
  cellId: number;
  rep: number;
  promptText: string;
  promptKey: string;
  /** The repository this cell runs against, or "" for chat. */
  target: string;
  surfaceKey: string;
  surfaceLabel: string;
  model: string;
  config: Record<string, unknown>;
};

/**
 * Everything the wave still owes, in a stable order.
 *
 * A run that already exists is never repeated, so re-invoking the runner *is* the resume
 * — the same property that let the previous agent harness survive rate-limit windows and
 * closed laptops without losing work.
 */
export function pendingRuns(db: Db, waveId: number): PendingRun[] {
  const rows = db
    .select({
      cellId: cells.id,
      plannedReps: cells.plannedReps,
      target: cells.target,
      promptText: prompts.text,
      promptKey: prompts.key,
      surfaceKey: waveSurfaces.surfaceKey,
      surfaceLabel: waveSurfaces.label,
      model: waveSurfaces.modelRequested,
      config: waveSurfaces.config,
    })
    .from(cells)
    .innerJoin(prompts, eq(prompts.id, cells.promptId))
    .innerJoin(waveSurfaces, eq(waveSurfaces.id, cells.waveSurfaceId))
    .where(eq(cells.waveId, waveId))
    .orderBy(cells.waveSurfaceId, cells.id)
    .all();

  const done = new Map<number, Set<number>>();
  const ids = rows.map((r) => r.cellId);
  if (ids.length) {
    const stored = db.select({ cellId: runs.cellId, rep: runs.rep, status: runs.status })
      .from(runs).where(inArray(runs.cellId, ids)).all();
    for (const r of stored) {
      // An error row is a visible record of a failure, not a measurement. It must not
      // satisfy the cell's debt: otherwise one transient network fault permanently
      // unbalances the wave, and the balance card reports a shortfall that re-running
      // can never close.
      if (r.status === "error") continue;
      if (!done.has(r.cellId)) done.set(r.cellId, new Set());
      done.get(r.cellId)!.add(r.rep);
    }
  }

  const out: PendingRun[] = [];
  for (const r of rows) {
    const have = done.get(r.cellId) ?? new Set<number>();
    for (let rep = 1; rep <= r.plannedReps; rep += 1) {
      if (have.has(rep)) continue;
      out.push({
        cellId: r.cellId, rep,
        promptText: r.promptText, promptKey: r.promptKey, target: r.target ?? "",
        surfaceKey: r.surfaceKey, surfaceLabel: r.surfaceLabel,
        model: r.model ?? "", config: (r.config ?? {}) as Record<string, unknown>,
      });
    }
  }
  return out;
}

/** Stores one run and every page it read. Dollars go in as micros; SQLite has no decimal. */
/**
 * Stores one completed run and everything it read, as a single transaction.
 *
 * Atomicity is not housekeeping here. The run row and its sources are two writes, and a
 * crash between them would leave a run that searched but stored nothing — which the health
 * card reads as an *extraction fault* and reports as a finding. An unattended overnight
 * wave gets one power cut and manufactures a false conclusion about someone's product. The
 * transaction is what makes "no sources" always mean no sources.
 */
export function recordRun(
  db: Db,
  cellId: number,
  rep: number,
  out: RunOutcome,
  /**
   * `id` is only for restoring a run that already has one — loading a published dataset back
   * into an empty store. Every review file, backlog note and published figure refers to a run
   * by the id it was recorded under, so a reload that renumbered them would make
   * `npm run review -- <file>` fail on a store that otherwise reproduces the season exactly.
   * A wave never passes it; the sequence assigns ids as normal.
   */
  opts: { importedFrom?: string; env?: EnvStamp | null; id?: number } = {},
): Run {
  return db.transaction((tx) => {
    // A repeat that failed and is now being re-run replaces its error row. The row existed
    // to make the failure visible while the wave was in flight; once a real measurement
    // lands there is nothing left for it to say, and (cell, rep) is unique.
    tx.delete(runs)
      .where(and(eq(runs.cellId, cellId), eq(runs.rep, rep), eq(runs.status, "error")))
      .run();

    const run = tx.insert(runs).values({
      ...(opts.id === undefined ? {} : { id: opts.id }),
      cellId, rep,
      status: out.truncated ? "voided" : "ok",
      modelResolved: out.modelResolved,
      toolVersion: out.toolVersion ?? null,
      rawResponse: JSON.stringify(out.raw),
      text: out.text,
      stopReason: out.stopReason,
      truncated: out.truncated,
      searchCount: out.searchCount,
      searchUnit: out.searchUnit,
      // Extracted by every adapter and, until now, dropped on the floor. What the engine
      // searched for and which of its tool calls failed cannot be recovered from the answer.
      searchQueries: out.searchQueries ?? [],
      toolErrors: out.toolErrors ?? [],
      toolTimeline: out.toolTimeline ?? [],
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      costUsd: out.costUsd === null ? null : Math.round(out.costUsd * 1e6),
      durationMs: out.durationMs,
      importedFrom: opts.importedFrom ?? null,
      // Null, not a guess: a run recorded without a stamp cannot claim the account was
      // clean. Only `false` is grounds for a report to drop the row.
      account: opts.env?.account ?? null,
      envClean: opts.env ? opts.env.clean : null,
      envIssues: opts.env ? opts.env.issues : null,
    }).returning().get();

    if (out.sources.length) {
      tx.insert(sources).values(out.sources.map((s) => ({
        runId: run.id, url: s.url, title: s.title ?? null, kind: s.kind, rank: s.rank ?? null,
        host: hostOf(s.url),
      }))).run();
    }
    return run;
  });
}

/**
 * Records that a cell failed, replacing any earlier failure for the same repeat.
 *
 * The replace is not tidiness. `(cell, rep)` is unique, so a plain insert threw the second
 * time a cell failed — and a cell failing twice is the ordinary case across resume
 * attempts, not an exotic one. The throw escaped the worker and killed the wave, so one
 * repeatedly flaky repository could end an unattended night at 2am, hours before anyone
 * looked. Only a prior *error* row is replaced: a real measurement is never overwritten by
 * a later failure.
 */
export function recordRunError(db: Db, cellId: number, rep: number, message: string): Run {
  return db.transaction((tx) => {
    tx.delete(runs)
      .where(and(eq(runs.cellId, cellId), eq(runs.rep, rep), eq(runs.status, "error")))
      .run();
    return tx.insert(runs).values({ cellId, rep, status: "error", error: message }).returning().get();
  });
}

export function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

// ---------------------------------------------------------------- reading back

export type WaveRow = {
  runId: number;
  cellId: number;
  rep: number;
  status: string;
  truncated: boolean;
  stopReason: string | null;
  searchCount: number | null;
  searchUnit: string | null;
  costUsd: number | null;
  text: string | null;
  promptKey: string;
  promptText: string;
  target: string;
  category: string | null;
  topic: string | null;
  shape: string | null;
  branded: boolean;
  surfaceKey: string;
  surfaceLabel: string;
  /** What the surface was planned to run on. */
  modelRequested: string | null;
  /** What the provider or transcript says answered. Null is unknown, not agreement. */
  modelResolved: string | null;
  toolVersion: string | null;
  sourceCount: number;
  /** Server-tool failures on this run. A wave full of these is not a measurement. */
  toolErrors: string[];
  /** How long the run took. The only honest basis for estimating what is left. */
  durationMs: number | null;
  error: string | null;
  /** `user@host` the run was produced on, and whether that account was clean at launch. */
  account: string | null;
  envClean: boolean | null;
  envIssues: string[] | null;
};

/** Every run in a wave, joined to the facets a report cuts by. */
export function waveRows(db: Db, waveId: number): WaveRow[] {
  const sourceCounts = db
    .select({ runId: sources.runId, n: sql<number>`count(*)`.as("n") })
    .from(sources).groupBy(sources.runId).as("sc");

  return db
    .select({
      runId: runs.id, cellId: cells.id, rep: runs.rep, status: runs.status,
      truncated: runs.truncated, stopReason: runs.stopReason,
      searchCount: runs.searchCount, searchUnit: runs.searchUnit,
      costUsd: runs.costUsd, text: runs.text,
      promptKey: prompts.key, promptText: prompts.text, target: cells.target,
      category: prompts.category, topic: prompts.topic, shape: prompts.shape, branded: prompts.branded,
      surfaceKey: waveSurfaces.surfaceKey, surfaceLabel: waveSurfaces.label,
      modelRequested: waveSurfaces.modelRequested, modelResolved: runs.modelResolved,
      toolVersion: runs.toolVersion,
      sourceCount: sql<number>`coalesce(${sourceCounts.n}, 0)`,
      toolErrors: runs.toolErrors,
      durationMs: runs.durationMs, error: runs.error,
      account: runs.account, envClean: runs.envClean, envIssues: runs.envIssues,
    })
    .from(runs)
    .innerJoin(cells, eq(cells.id, runs.cellId))
    .innerJoin(prompts, eq(prompts.id, cells.promptId))
    .innerJoin(waveSurfaces, eq(waveSurfaces.id, cells.waveSurfaceId))
    .leftJoin(sourceCounts, eq(sourceCounts.runId, runs.id))
    .where(eq(cells.waveId, waveId))
    .orderBy(cells.waveSurfaceId, cells.id, runs.rep)
    .all();
}

/** Planned versus actual, per surface — the input to the balance check. */
export function plannedVsActual(db: Db, waveId: number) {
  return db
    .select({
      surfaceKey: waveSurfaces.surfaceKey,
      surfaceLabel: waveSurfaces.label,
      cellCount: sql<number>`count(distinct ${cells.id})`,
      planned: sql<number>`sum(${cells.plannedReps})`,
      actual: sql<number>`(select count(*) from ${runs} r
        join ${cells} c on c.id = r.cell_id where c.wave_surface_id = ${waveSurfaces.id})`,
    })
    .from(waveSurfaces)
    .innerJoin(cells, eq(cells.waveSurfaceId, waveSurfaces.id))
    .where(eq(waveSurfaces.waveId, waveId))
    .groupBy(waveSurfaces.id)
    .all();
}

export function totalSpentUsd(db: Db, waveId: number): number {
  const row = db
    .select({ micros: sql<number>`coalesce(sum(${runs.costUsd}), 0)` })
    .from(runs)
    .innerJoin(cells, eq(cells.id, runs.cellId))
    .where(and(eq(cells.waveId, waveId)))
    .get();
  return (row?.micros ?? 0) / 1e6;
}

export function gradesFor(db: Db, waveId: number) {
  return db
    .select({ runId: grades.runId, stance: grades.stance, winner: grades.winner, needsReview: grades.needsReview })
    .from(grades)
    .innerJoin(runs, eq(runs.id, grades.runId))
    .innerJoin(cells, eq(cells.id, runs.cellId))
    .where(eq(cells.waveId, waveId))
    .all();
}
