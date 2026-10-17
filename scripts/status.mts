/**
 * Where a wave has got to, for a person who is half asleep or holding coffee.
 *
 * Read-only, so it is safe to run against a wave that is mid-flight — which is the whole
 * point. An eight-hour unattended run needs an answer to "is this working, and when is it
 * done" that does not involve reading a log.
 *
 *   npx tsx scripts/status.mts <projectSlug> [--wave 3]
 */
import { db } from "../src/db/client";
import { getProject } from "../src/db/repo";
import { getWave, listWaves, plannedVsActual, surfacesOf, waveRows } from "../src/db/waves";
import { humanDuration, waveProgress } from "../src/derive/progress";
import { waveHealth } from "../src/derive/wave";

const argv = process.argv.slice(2);
const slug = argv[0];
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
if (!slug) { console.error("usage: status.mts <projectSlug> [--wave <id>]"); process.exit(2); }

const d = db();
const project = getProject(d, slug);
if (!project) { console.error(`no project '${slug}'`); process.exit(1); }

const waves = listWaves(d, project.id);
const wave = flag("wave") ? getWave(d, Number(flag("wave"))) : waves[0];
if (!wave || wave.projectId !== project.id) { console.error("no such wave"); process.exit(1); }

const rows = waveRows(d, wave.id);
const planned = plannedVsActual(d, wave.id).map((p) => ({
  surfaceKey: p.surfaceKey, surfaceLabel: p.surfaceLabel, planned: Number(p.planned),
}));
const p = waveProgress(
  rows, planned,
  rows.filter((r) => r.error).map((r) => ({ surfaceLabel: r.surfaceLabel, message: r.error! })),
);

const bar = (done: number, total: number, width = 24) => {
  const filled = total ? Math.round((done / total) * width) : 0;
  return `${"█".repeat(filled)}${"·".repeat(Math.max(0, width - filled))}`;
};
const pct = (n: number, dd: number) => (dd ? `${Math.round((100 * n) / dd)}%` : "—");

console.log(`\n${project.name} · wave ${wave.id} "${wave.name}" · ${wave.status}`);
console.log(`${bar(p.done, p.planned)}  ${p.done}/${p.planned} runs (${pct(p.done, p.planned)})`);
if (p.pending) console.log(`${p.pending} owed · about ${humanDuration(p.etaMs)} left at the pace so far`);
if (p.spentUsd > 0) console.log(`$${p.spentUsd.toFixed(2)} spent${wave.costCapUsd ? ` of $${wave.costCapUsd} cap` : ""}`);

console.log("");
for (const s of p.surfaces) {
  console.log(`  ${s.surfaceLabel}`);
  console.log(
    `    ${bar(s.done, s.planned, 18)} ${s.done}/${s.planned}` +
    `${s.pending ? ` · ${humanDuration(s.etaMs)} left` : " · done"}`,
  );
  const notes = [
    s.voided ? `${s.voided} voided` : null,
    s.errored ? `${s.errored} errored` : null,
    s.toolFailed ? `${s.toolFailed} with a failed tool call` : null,
    s.medianDurationMs ? `median ${humanDuration(s.medianDurationMs)}` : null,
  ].filter(Boolean);
  if (notes.length) console.log(`    ${notes.join(" · ")}`);
}

if (p.failures.length) {
  console.log(`\nfailures, most frequent first:`);
  for (const f of p.failures.slice(0, 6)) console.log(`  ${String(f.n).padStart(4)} × ${f.message}`);
}

// The health card is what says whether the runs that did land are worth anything. A wave
// can be 100% complete and still not be a measurement.
const health = waveHealth(rows, planned);
if (health.warnings.length) {
  console.log(`\nhealth:`);
  for (const w of health.warnings) console.log(`  · ${w}`);
} else if (health.runs) {
  console.log(`\nhealth: balanced, nothing truncated, no extraction faults.`);
}

console.log(`\nsurfaces: ${surfacesOf(d, wave.id).map((s) => `${s.label} (${s.modelRequested}, ${s.reps}×)`).join(" · ")}`);
