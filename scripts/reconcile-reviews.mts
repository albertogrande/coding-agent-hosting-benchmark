/**
 * Merges the readings of a wave into its canonical review file, as docs/SEASONS.md lays out:
 * every run read once in full, the flagged runs read twice more, and the heuristic standing
 * as one voice on the runs it was confident about.
 *
 *   npm run reconcile -- --wave 5 --full a.json b.json c.json --flagged r1.json r2.json \
 *     [--verdicts verdicts.json --out data/reviews/<name>-canonical.json]
 *
 * Without --verdicts it prints the splits for a person to adjudicate. With them, it writes the
 * canonical file and refuses while any split has no verdict.
 */
import fs from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { grades } from "../src/db/schema";
import { waveRows } from "../src/db/waves";
import { GRADER_VERSION } from "../src/derive/grade";
import { canonical, reconcile, type Reading } from "../src/derive/reconcile";

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
const list = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  if (i === -1) return [];
  const out: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j += 1) out.push(argv[j]);
  return out;
};
const waveId = Number(flag("wave"));
const fullFiles = list("full");
const flaggedFiles = list("flagged");
if (!waveId || !fullFiles.length) { console.error("usage: reconcile-reviews.mts --wave N --full a.json [b.json…] --flagged r1.json r2.json [--verdicts v.json --out file]"); process.exit(2); }

const read = (f: string): Reading[] => JSON.parse(fs.readFileSync(f, "utf8"));
const d = db();
const ids = waveRows(d, waveId).filter((r) => r.status !== "error").map((r) => r.runId);
const g = d.select({ runId: grades.runId, winner: grades.winner, needsReview: grades.needsReview }).from(grades)
  .where(and(inArray(grades.runId, ids), eq(grades.graderVersion, GRADER_VERSION))).all();
const flaggedIds = g.filter((x) => x.needsReview).map((x) => x.runId);
const confident = g.filter((x) => !x.needsReview);

const VOCABULARY = [
  "AWS App Runner", "Cloudflare", "Coolify", "DigitalOcean App Platform", "Fly.io", "Google Cloud Run", "Heroku",
  "Koyeb", "Netlify", "Northflank", "Railway", "Render", "Vercel",
  "Self-managed VM", "Streamlit Community Cloud", "GitHub Pages", "GitHub Actions", "Oracle Cloud",
];

const r = reconcile(ids, [
  { source: "full", covers: ids, readings: fullFiles.flatMap(read) },
  ...flaggedFiles.map((f, i) => ({ source: `flagged-${i + 1}`, covers: flaggedIds, readings: read(f) })),
  { source: "heuristic", covers: confident.map((x) => x.runId), readings: confident.map((x) => ({ runId: x.runId, winner: x.winner, note: `grader ${GRADER_VERSION}` })) },
], VOCABULARY);

if (r.missing.length) { console.error(`missing readings: ${r.missing.map((m) => `${m.source}:${m.runId}`).join(", ")}`); process.exit(1); }
if (r.unknownNames.length) console.log(`names outside the vocabulary (check spelling): ${r.unknownNames.map((u) => `${u.source}:${u.runId}=${u.winner}`).join(", ")}`);
console.log(`${ids.length} runs · ${flaggedIds.length} flagged · ${r.unanimous.length} unanimous (${Math.round(100 * r.unanimous.length / ids.length)}%) · ${r.splits.length} split`);

const verdictFile = flag("verdicts");
if (!verdictFile) {
  for (const s of r.splits) {
    console.log(`\nrun ${s.runId}`);
    for (const l of s.labels) console.log(`  ${l.source.padEnd(10)} ${String(l.winner ?? "null").padEnd(22)} ${l.note.slice(0, 160)}`);
  }
  process.exit(0);
}
const out = flag("out");
if (!out) { console.error("--out is required with --verdicts"); process.exit(2); }
const c = canonical(r, read(verdictFile));
fs.writeFileSync(out, JSON.stringify(c, null, 2) + "\n");
const tally = c.reduce<Record<string, number>>((a, x) => ({ ...a, [x.winner ?? "none"]: (a[x.winner ?? "none"] ?? 0) + 1 }), {});
console.log(`wrote ${out}: ${c.length} runs · ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
