/**
 * Applies a person's relabels to an agent wave, from a file that is kept in git.
 *
 *   npm run review -- data/reviews/<file>.json [--dry-run]
 *
 * The file is a list of `{ "runId", "winner", "note" }`: the platform the run adopted (a
 * catalogue name, an unlisted name the agent used, or null for "no platform"), and what the
 * reviewer read to decide. The relabel lands on the grade at the current grader version,
 * and the report shows it as a person's call beside the heuristic's.
 *
 * A file rather than a form so the review is a diff: which runs, what was decided, why, and
 * when — next to the wave file and the prompts it was made on.
 */
import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { db } from "../src/db/client";
import { grades, runs } from "../src/db/schema";
import { reviewAdoption } from "../src/db/grades-repo";
import { GRADER_VERSION } from "../src/derive/grade";

type Relabel = { runId: number; winner: string | null; note: string };

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: review.mts <relabels.json> [--dry-run]");
  process.exit(2);
}
const dryRun = argv.includes("--dry-run");
const relabels: Relabel[] = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));

const d = db();
let applied = 0;
for (const r of relabels) {
  const row = d.select({ id: grades.id, winner: grades.winner, needsReview: grades.needsReview, reviewedAt: grades.reviewedAt })
    .from(grades)
    .where(and(eq(grades.runId, r.runId), eq(grades.graderVersion, GRADER_VERSION)))
    .get();
  if (!row) {
    console.error(`run ${r.runId}: no grade at ${GRADER_VERSION} — grade the wave first`);
    process.exit(1);
  }
  const exists = d.select({ id: runs.id }).from(runs).where(eq(runs.id, r.runId)).get();
  if (!exists) { console.error(`run ${r.runId}: no such run`); process.exit(1); }
  const from = row.winner ?? "none";
  const to = r.winner ?? "none";
  const mark = from === to ? "=" : "→";
  console.log(`run ${String(r.runId).padStart(4)}  ${from.padEnd(18)} ${mark} ${to.padEnd(24)} ${row.reviewedAt ? "(re-reviewed) " : ""}${r.note.slice(0, 70)}`);
  if (!dryRun) { reviewAdoption(d, row.id, r.winner, r.note); applied += 1; }
}
console.log(dryRun ? `\n${relabels.length} relabel(s) read; nothing written (--dry-run).` : `\n${applied} relabel(s) applied at ${GRADER_VERSION}.`);
