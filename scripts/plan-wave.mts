/**
 * Plans a wave from a config file.
 *
 * The design of a wave — which surfaces, which model, how many repeats, what output
 * budget, which repositories — is the thing most worth reviewing before a night is spent
 * on it, and the thing most easily buried in a script nobody reads. So it lives in a JSON
 * file that can be diffed, reviewed and kept.
 *
 *   npx tsx scripts/plan-wave.mts waves/claude-chat.json
 *   npx tsx scripts/plan-wave.mts waves/claude-chat.json --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/db/client";
import { getProject } from "../src/db/repo";
import { listPromptSets, planWave, promptsIn, type PlannedSurface } from "../src/db/waves";
import { isAgentSurface } from "../src/lib/surfaces";
import { humanDuration } from "../src/derive/progress";

/**
 * How long one run takes, when nothing has been observed yet.
 *
 * An agent run clones a repository and works in it; the original arm reported 10-25
 * minutes and timed out at 35. A chat run is a single call. The range is wide on purpose —
 * the point is not precision, it is that a wave costing three nights should say so before
 * anyone starts it rather than after the second one.
 */
const MINUTES_PER_RUN: Record<"agent" | "chat", [number, number]> = {
  agent: [10, 25],
  chat: [0.3, 1.5],
};

type WaveConfig = {
  project: string;
  /** The prompt set's version string, as imported. */
  promptSet: string;
  name: string;
  costCapUsd?: number;
  /** Required when the surfaces do not share a repeat count, and stored on the wave. */
  allowUnequalReps?: string;
  surfaces: {
    surfaceKey: string;
    label: string;
    model: string;
    reps: number;
    config?: Record<string, unknown>;
    /** `sha` pins the commit every cell runs against; without it the clone takes HEAD that night. */
    targets?: { id: string; url: string; sha?: string }[];
  }[];
};

const argv = process.argv.slice(2);
const file = argv[0];
if (!file) {
  console.error("usage: plan-wave.mts <config.json> [--dry-run]");
  process.exit(2);
}

const cfg = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as WaveConfig;
const d = db();

const project = getProject(d, cfg.project);
if (!project) { console.error(`no project '${cfg.project}'`); process.exit(1); }

const set = listPromptSets(d, project.id).find((s) => s.version === cfg.promptSet);
if (!set) {
  console.error(
    `no prompt set at version '${cfg.promptSet}' in '${cfg.project}'. ` +
    `Have: ${listPromptSets(d, project.id).map((s) => s.version).join(", ") || "(none)"}`,
  );
  process.exit(1);
}

const promptCount = promptsIn(d, set.id).length;
const surfaces: PlannedSurface[] = cfg.surfaces.map((s) => ({
  surfaceKey: s.surfaceKey,
  label: s.label,
  modelRequested: s.model,
  reps: s.reps,
  config: s.config ?? {},
  ...(s.targets?.length ? { targets: s.targets } : {}),
}));

const runsFor = (s: WaveConfig["surfaces"][number]) =>
  promptCount * (s.targets?.length || 1) * s.reps;
const total = cfg.surfaces.reduce((n, s) => n + runsFor(s), 0);

console.log(`\n${cfg.name}`);
console.log(`  project ${project.name} · prompt set ${cfg.promptSet} (${promptCount} prompts)`);
for (const s of cfg.surfaces) {
  const t = s.targets?.length ? ` × ${s.targets.length} repos` : "";
  console.log(`  ${s.label}: ${s.model} · ${promptCount} prompts${t} × ${s.reps} reps = ${runsFor(s)} runs`);
  if (s.config && Object.keys(s.config).length) console.log(`    config ${JSON.stringify(s.config)}`);
}
console.log(`  ${total} runs total${cfg.costCapUsd ? ` · cap $${cfg.costCapUsd}` : " · no spend cap (subscription surfaces)"}`);

// Time is the real budget on a subscription, and it is the one nobody estimates.
const [loMin, hiMin] = cfg.surfaces.reduce<[number, number]>(([lo, hi], s) => {
  const [a, b] = MINUTES_PER_RUN[isAgentSurface(s.surfaceKey) ? "agent" : "chat"];
  return [lo + runsFor(s) * a, hi + runsFor(s) * b];
}, [0, 0]);
console.log(
  `  about ${humanDuration(loMin * 60_000)} to ${humanDuration(hiMin * 60_000)} of wall clock, ` +
  `run one at a time`,
);
if (hiMin > 10 * 60) {
  console.log(
    `  → longer than one night. The runner resumes, so this is several sessions rather than\n` +
    `    one long one — but plan it as several, and check status between them.`,
  );
}

if (argv.includes("--dry-run")) {
  console.log("\nDry run — nothing was planned.");
  process.exit(0);
}

// planWave refuses an unrunnable surface key and an unequal design; both are cheaper to
// hear now than at run 300.
const wave = planWave(d, {
  projectId: project.id,
  promptSetId: set.id,
  name: cfg.name,
  costCapUsd: cfg.costCapUsd,
  surfaces,
}, cfg.allowUnequalReps ? { allowUnequalReps: cfg.allowUnequalReps } : {});

console.log(`\nplanned as wave ${wave.id}.`);
console.log(`next: npm run preflight -- ${cfg.project} --wave ${wave.id}`);
