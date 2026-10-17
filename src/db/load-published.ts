/**
 * Writes a published wave dataset into the store.
 *
 * Separate from `scripts/load-published.mts` so it can be tested against a real database:
 * an untested loader is the same defect as the reproduce path it exists to fix — a claim
 * that the numbers come back, with nothing checking that they do. The script is argv
 * parsing and printing over this.
 *
 * Every row goes in through the functions a real wave uses — `createProject`,
 * `savePromptSet`, `planWave`, `recordRun` — because a loader that wrote rows its own way
 * would drift from what `run-wave` produces, and then the fast path would re-derive numbers
 * from a store shaped unlike the one the season was graded in.
 */
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { createProject, getProject } from "./repo";
import { planWave, recordRun, savePromptSet } from "./waves";
import { cells, grades, prompts } from "./schema";
import { gradeFor, outcomeFor, planLoad, type PublishedDataset } from "@/derive/load-dataset";
import { PLATFORM_ALIASES } from "@/derive/adoption";

export type LoadResult = {
  waveId: number;
  projectId: number;
  loaded: number;
  gradesWritten: number;
  /** Runs the dataset carried that no cell in the restored design could hold. */
  skipped: string[];
  /** What a published record cannot restore, for the caller to print. */
  losses: string[];
  graderVersion: string;
};

export function loadPublished(
  db: Db,
  data: PublishedDataset,
  opts: { slug?: string; name?: string; file?: string } = {},
): LoadResult {
  const plan = planLoad(data);
  const slug = opts.slug ?? "hosting";

  if (getProject(db, slug)) {
    throw new Error(
      `project '${slug}' already exists in this store. Loading again would plan a second ` +
      `wave beside the first and leave two answers to "which wave is this". Use a new slug, ` +
      `or point AEO_DB at a fresh file.`,
    );
  }

  /**
   * Platforms come from the runs, not from a list typed here.
   *
   * The season has no roster — the platforms in the result are whichever ones the answers
   * name — so seeding a vocabulary by hand would make the reloaded store measure a
   * different field from the one the dataset recorded.
   */
  const names = [...new Set(plan.runs.flatMap((r) => [r.adopted, ...(r.platformsNamed ?? [])]))]
    .filter((n): n is string => Boolean(n))
    .sort();

  /**
   * Aliases come from the recogniser's own spelling list, not from an empty array.
   *
   * A published record does not carry the project's alias lists, and a platform seeded with
   * none used to match every run — "named" read 132 for all thirteen platforms and the
   * named-against-chosen figure was silently gone. Platforms the recogniser does not know
   * (Streamlit Community Cloud, a self-managed VM) are seeded under their own name, which is
   * also how the original wave recorded them: adopted, never "named".
   */
  const aliasesFor = (name: string): string[] => PLATFORM_ALIASES[name] ?? [name];

  /**
   * A record that publishes its vocabulary is seeded from it, verbatim, so `named` comes back
   * as published. A name the runs carry that the list lacks still gets the fallback rather
   * than nothing, for the same reason the fallback exists.
   */
  const published = new Map((plan.platforms ?? []).map((p) => [p.name, p] as const));
  // A record that publishes its vocabulary is seeded with it and nothing else. A platform the
  // runs adopted outside that list (Streamlit Community Cloud, a self-managed VM) stays
  // unlisted, as it was when the wave ran. Seeding it under its own name made a reload count
  // it as "named" wherever the word appeared, and "Pages" became a platform of its own.
  const seed = published.size ? [...published.keys()] : [...names];
  const competitors = [...new Set(seed)].sort().map((n) => {
    const p = published.get(n);
    return p
      ? { name: n, aliases: [...p.aliases], domains: [...(p.domains ?? [])], ...(p.caseSensitive ? { caseSensitive: true } : {}) }
      : { name: n, aliases: aliasesFor(n), domains: [] };
  });

  const project = createProject(db, {
    slug,
    name: opts.name ?? "Hosting",
    // Omitted, not null: a category benchmark has no platform it is about, and the stance
    // ladder derives its focal row while reading instead.
    competitors,
    domains: [],
    categories: [],
  });

  const set = savePromptSet(db, project.id, {
    version: `published:${plan.waveName.slice(0, 40)}`,
    name: `${plan.waveName} (loaded from a published dataset)`,
    design: {
      loadedFrom: opts.file ?? null,
      schema: data.schema,
      note: "Prompts and design restored from a published dataset, not from the original wave file.",
    },
    categories: [],
    prompts: plan.prompts.map((p) => ({
      key: p.key,
      text: p.text,
      shape: p.shape,
      branded: false,
      tags: [],
      // Where the prompt came from. The dataset is the provenance here — the original
      // wave file is not in a clean clone, and saying "published dataset" is honest
      // about that where naming the wave file would not be.
      source: `published:${data.schema}`,
    })),
  });

  const wave = planWave(db, {
    projectId: project.id,
    promptSetId: set.id,
    name: plan.waveName,
    surfaces: [{
      surfaceKey: plan.surface.key,
      label: plan.surface.label,
      // A wave surface has to name the model it asked for. A dataset with no requested
      // model recorded gets the empty string rather than a guess at one.
      modelRequested: plan.surface.modelRequested ?? "",
      reps: plan.surface.reps,
      config: { loadedFromPublished: true },
      targets: plan.targets,
    }],
  });

  /**
   * Cells are addressed by (prompt key, repository), which is how a published row identifies
   * its own. The dataset's `cellId` is the *original* store's id and means nothing in this
   * one — reusing it is how a loader silently attaches runs to the wrong cell.
   */
  const keyByPromptId = new Map(
    db.select({ id: prompts.id, key: prompts.key }).from(prompts).where(eq(prompts.setId, set.id)).all()
      .map((p) => [p.id, p.key] as const),
  );
  const cellByKey = new Map(
    db.select().from(cells).where(eq(cells.waveId, wave.id)).all()
      .map((c) => [`${keyByPromptId.get(c.promptId)} ${c.target}`, c.id] as const),
  );

  let loaded = 0;
  let gradesWritten = 0;
  const skipped: string[] = [];

  for (const run of plan.runs) {
    const cellId = cellByKey.get(`${run.promptKey} ${run.repository.id}`);
    if (!cellId) {
      skipped.push(`run ${run.runId}: no cell for ${run.promptKey} × ${run.repository.id}`);
      continue;
    }

    const stored = recordRun(db, cellId, run.rep, outcomeFor(run) as never, {
      // The published id, kept: every review file and published figure names a run by it.
      id: run.runId,
      importedFrom: `published:${data.schema}`,
      env: run.envClean === null ? null : { account: run.account ?? "", clean: run.envClean, issues: [] },
    });
    loaded++;

    const g = gradeFor(run);
    if (!g) continue;
    db.insert(grades).values({
      runId: stored.id,
      // The dataset's version, never the current one: the loaded grades are the published
      // verdict, a re-grade writes today's version beside them, and the two are a diff.
      graderVersion: plan.graderVersion,
      stance: g.stance,
      brandRank: g.brandRank,
      winner: g.winner,
      platformsNamed: g.platformsNamed,
      caveat: g.caveat,
      evidence: g.evidence,
      decisionMode: g.decisionMode,
      needsReview: g.needsReview,
      reviewNote: g.reviewNote,
      reviewedAt: g.reviewedAt,
    }).run();
    gradesWritten++;
  }

  return {
    waveId: wave.id,
    projectId: project.id,
    loaded,
    gradesWritten,
    skipped,
    losses: plan.losses,
    graderVersion: plan.graderVersion,
  };
}
