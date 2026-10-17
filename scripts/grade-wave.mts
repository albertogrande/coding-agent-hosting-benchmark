/**
 * Grades a stored wave and prints the funnel.
 *
 *   npx tsx scripts/grade-wave.mts <waveId> [--regrade]
 */
import { db } from "../src/db/client";
import { getWave } from "../src/db/waves";
import { getProject, platformsOf } from "../src/db/repo";
import { explorerRows, gradeWave } from "../src/db/grades-repo";
import { cutBy, funnel, rivalWins, STAGES, through } from "../src/derive/funnel";
import { REACH_STAGES } from "../src/derive/grade";
import { stability } from "../src/derive/wave";
import { projects } from "../src/db/schema";
import { eq } from "drizzle-orm";

const waveId = Number(process.argv[2]);
if (!waveId) { console.error("usage: grade-wave.mts <waveId> [--regrade]"); process.exit(2); }

const d = db();
const wave = getWave(d, waveId);
if (!wave) { console.error(`no wave ${waveId}`); process.exit(1); }
const project = d.select().from(projects).where(eq(projects.id, wave.projectId)).get()!;
void getProject;

const r = gradeWave(d, waveId, project.brand, platformsOf(project), { regrade: process.argv.includes("--regrade") });
console.log(`graded ${r.graded} runs · ${r.voided} voided · ${r.needsReview} need review\n`);

const rows = explorerRows(d, waveId);

/**
 * `--focus <platform>` reads the ladder about somebody; without it the report is about the
 * wave. The stored stance says how far each run got, because this project has no focal
 * platform and the rungs of the ladder are about one — printing them against the stored
 * vocabulary put four zeroes on the screen and called it a funnel.
 */
const focusIdx = process.argv.indexOf("--focus");
const focus = focusIdx === -1 ? null : process.argv[focusIdx + 1];
const view = focus ? through(rows, focus) : rows;

if (focus) {
  const f = funnel(view, "cumulative");
  console.log(`LADDER, about ${focus} — ${f.graded} gradeable runs (${f.voided} voided, excluded)`);
  for (const s of STAGES) {
    console.log(`  ${s.padEnd(13)} ${String(f.counts[s]).padStart(4)}  ${(100 * f.share[s]).toFixed(1)}%`);
  }
} else {
  const graded = rows.filter((r) => r.stance && r.stance !== "voided");
  console.log(`REACH — ${graded.length} gradeable runs (${rows.filter((r) => r.stance === "voided").length} voided, excluded)`);
  for (const s of REACH_STAGES) {
    const n = graded.filter((r) => r.stance === s).length;
    console.log(`  ${s.padEnd(13)} ${String(n).padStart(4)}  ${graded.length ? ((100 * n) / graded.length).toFixed(1) : "0.0"}%`);
  }
  console.log(`  (pass --focus "<platform>" to read the ladder about one of them)`);
}

console.log(`\nBY SURFACE`);
for (const c of cutBy(view, (x) => x.surfaceLabel, "final")) {
  const parts = focus
    ? STAGES.map((s) => `${s} ${(100 * c.funnel.share[s]).toFixed(0)}%`).join("  ")
    : `${c.funnel.graded} graded`;
  console.log(`  ${c.label.padEnd(26)} n=${String(c.n).padStart(3)}  ${parts}`);
}

const st = stability(view);
console.log(`\nSTABILITY  ${st.flipRate === null ? "not comparable" : `${(100 * st.flipRate).toFixed(0)}% of ${st.comparable} cells changed stance between repeats`}`);
console.log(`ADOPTED    ${rivalWins(rows, "").slice(0, 6).map((x) => `${x.name} ${x.n}`).join(" · ")}`);
