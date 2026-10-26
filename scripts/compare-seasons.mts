/**
 * One season's cell majorities against another's, with the paired interval.
 *
 * Each side is a published dataset file, which needs nothing but a clone, or a wave id in the
 * store, which must be graded first (`npm run grade -- N`) with its review file applied.
 *
 *   npm run compare -- --wave data/published/hosting-s1-night2-opus55.json \
 *     --against data/published/hosting-s1-opus55.json --exclude-frame open
 *   npm run compare -- --wave 5 --against 3 --control 6 [--floor-lo 0.73 --floor-hi 0.9]
 *
 * A file side reads the published labels as they are. A side with no rows is an error, never
 * a "0 of 0". With a floor, prints the verdict of the angle rule in docs/SEASONS.md.
 */
import fs from "node:fs";
import { db } from "../src/db/client";
import { agentRunRows } from "../src/db/agent-runs";
import { getWave } from "../src/db/waves";
import { splitByProvenance } from "../src/derive/benchmark";
import type { AgentRow } from "../src/derive/agent-benchmark";
import type { PublishedDataset } from "../src/derive/load-dataset";
import { rowOfPublished } from "../src/derive/season-factpack";
import { agreementWithInterval, angleVerdict, controlReadout } from "../src/derive/season-compare";

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
const a = flag("wave");
const b = flag("against");
if (!a || !b) { console.error("usage: compare-seasons.mts --wave <file|N> --against <file|M> [--control <file|K>] [--exclude-frame F] [--floor-lo X --floor-hi Y]"); process.exit(2); }

const excluded = flag("exclude-frame");
type Side = { label: string; rows: AgentRow[] };
function sideOf(ref: string): Side {
  let label: string, rows: AgentRow[];
  if (ref.endsWith(".json")) {
    const ds = JSON.parse(fs.readFileSync(ref, "utf8")) as PublishedDataset;
    label = `wave ${ds.wave?.id} "${ds.wave?.name}"`;
    rows = ds.runs.map((r) => rowOfPublished(r, ds));
  } else {
    const d = db();
    label = `wave ${ref} "${getWave(d, Number(ref))?.name}"`;
    rows = agentRunRows(d, Number(ref));
  }
  rows = splitByProvenance(rows.filter((r) => r.status !== "error")).usable.filter((r) => r.frame !== excluded);
  if (!rows.length) {
    console.error(`${label}: no usable runs. A wave id needs grading in the store first; a published file needs no setup.`);
    process.exit(1);
  }
  return { label, rows };
}
const A = sideOf(a);
const B = sideOf(b);
const ra = A.rows;
const rb = B.rows;
const r = agreementWithInterval(ra, rb);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const short = (s: Side) => s.label.split(" \"")[0];

console.log(`${A.label} (${ra.length} runs)`);
console.log(`against ${B.label} (${rb.length} runs)${excluded ? ` · frame ${excluded} excluded` : ""}\n`);
console.log(`cell majorities agreeing: ${r.agreeing} of ${r.comparable}` +
  (r.rate !== null ? ` = ${pct(r.rate)}` : "") +
  (r.interval ? ` · 95% interval ${pct(r.interval.lo)} to ${pct(r.interval.hi)} (repositories resampled, paired)` : ""));
console.log(`not compared: ${r.noMajority.length} cell(s) with no majority on one side · ${r.unmatched} unmatched`);
// Printed oldest first: what the cell was in the --against wave, then what it became.
for (const x of r.disagreements) console.log(`  ${x.target} × ${x.frame}: ${short(B)} ${x.b} → ${short(A)} ${x.a}`);

const lo = flag("floor-lo"), hi = flag("floor-hi");
if (lo && hi) console.log(`\nangle rule: ${angleVerdict(r.rate, { lo: Number(lo), hi: Number(hi) })}`);

// The control: one run per cell of the --against wave's model on the --wave wave's CLI.
const c = flag("control");
if (c) {
  const C = sideOf(c);
  const rc = C.rows;
  const x = controlReadout(rc, rb, ra);
  console.log(`\ncontrol ${C.label} (${rc.length} runs)`);
  console.log(`of ${x.changed.length} changed cells: ${x.sideS0} like ${short(B)} · ${x.sideS1} like ${short(A)} · ${x.neither} like neither` +
    (x.missing ? ` · ${x.missing} with no gradeable control run` : ""));
  for (const y of x.changed) console.log(`  ${y.target} × ${y.frame}: ${short(B)} ${y.s0} → ${short(A)} ${y.s1} · control ${y.control ?? "missing"}`);
  console.log(`over every cell: control matches ${short(B)}'s majority on ${x.matchS0.matching} of ${x.matchS0.cells}, ${short(A)}'s on ${x.matchS1.matching} of ${x.matchS1.cells}`);
  console.log(`control rule: ${x.verdict}`);
}
