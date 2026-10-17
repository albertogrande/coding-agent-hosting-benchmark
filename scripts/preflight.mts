/**
 * Checks a planned wave before a night is committed to it.
 *
 * The failure this exists for: an expired CLI session fails every cell in about a second,
 * so a wave launched at midnight is finished, empty, by ten past — and looks from the
 * outside exactly like a wave that ran. Everything here is read-only and free except one
 * probe prompt, which is the only way to tell a live session from a dead one.
 *
 *   npx tsx scripts/preflight.mts <projectSlug> --wave 3 [--benchmark] [--no-probe] [--strict]
 */
import { db } from "../src/db/client";
import { getProject, platformsOf } from "../src/db/repo";
import { getWave, listPromptSets, promptsIn, surfacesOf } from "../src/db/waves";
import { cells as cellsTable } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";
import { checkDesign, clearToRun, type Check } from "../src/derive/preflight";
import { checkEnvironment, environmentStamp } from "../src/runner/preflight";

const argv = process.argv.slice(2);
const slug = argv[0];
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
if (!slug) {
  console.error("usage: preflight.mts <projectSlug> --wave <id> [--benchmark] [--no-probe]");
  process.exit(2);
}

const d = db();
const project = getProject(d, slug);
if (!project) { console.error(`no project '${slug}'`); process.exit(1); }

const waveId = Number(flag("wave") ?? NaN);
const wave = Number.isFinite(waveId) ? getWave(d, waveId) : undefined;
if (!wave || wave.projectId !== project.id) {
  console.error(`no wave ${flag("wave") ?? "(none given)"} in '${slug}' — pass --wave <id>`);
  process.exit(1);
}

const set = listPromptSets(d, project.id).find((s) => s.id === wave.promptSetId);
const prompts = set ? promptsIn(d, set.id).map((p) => ({ key: p.key, text: p.text })) : [];

const cellCounts = new Map(
  d.select({ id: cellsTable.waveSurfaceId, n: sql<number>`count(*)` })
    .from(cellsTable).where(eq(cellsTable.waveId, wave.id))
    .groupBy(cellsTable.waveSurfaceId).all()
    .map((r) => [r.id, Number(r.n)]),
);

const surfaces = surfacesOf(d, wave.id).map((s) => ({
  surfaceKey: s.surfaceKey,
  label: s.label,
  modelRequested: s.modelRequested,
  reps: s.reps,
  config: s.config,
  cells: cellCounts.get(s.id) ?? 0,
}));

const checks: Check[] = [
  ...checkDesign({
    project: { name: project.name, platforms: platformsOf(project) },
    prompts, surfaces, forBenchmark: argv.includes("--benchmark"),
  }),
  ...await checkEnvironment(surfaces, { probeAuth: !argv.includes("--no-probe") }),
];

const MARK: Record<Check["status"], string> = {
  pass: "  ok  ", warn: " warn ", fail: " FAIL ", unknown: "  ??  ",
};

console.log(`\npreflight · ${project.name} · wave ${wave.id} "${wave.name}"`);
console.log(`account · ${(await environmentStamp()).account}\n`);
for (const c of checks) {
  console.log(`[${MARK[c.status]}] ${c.name}`);
  console.log(`          ${c.detail}`);
  if (c.fix) console.log(`          → ${c.fix}`);
}

const counts = checks.reduce<Record<string, number>>((a, c) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {});
console.log(
  `\n${counts.pass ?? 0} ok · ${counts.warn ?? 0} warn · ${counts.unknown ?? 0} unknown · ${counts.fail ?? 0} failed`,
);

if (counts.unknown) {
  // An unknown is never folded into either answer: "we could not tell" and "it is fine"
  // lead to different decisions at 11pm.
  console.log("\nSomething could not be checked. That is not the same as it being fine — re-run, or decide knowingly.");
}

// `run-wave` asks with --strict: a wave starts only when every check could be run.
if (argv.includes("--strict") && counts.unknown) {
  console.error("\nNot clear to run under --strict: a check that could not run is not a pass.");
  process.exit(1);
}

if (!clearToRun(checks)) {
  console.error("\nNot clear to run. Fix the failures above; a wave started now would spend the night proving it.");
  process.exit(1);
}
console.log("\nClear to run.");
