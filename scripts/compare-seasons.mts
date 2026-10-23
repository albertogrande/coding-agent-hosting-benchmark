/**
 * One season's cell majorities against another's, with the paired interval, from the store.
 *
 *   npm run compare -- --wave 4 --against 3 [--exclude-frame open] [--floor-lo 0.73 --floor-hi 0.9]
 *   npm run compare -- --wave 5 --against 3 --control 6 [--exclude-frame open]
 *
 * Reads both waves at the current grader version, so grade each one first (`npm run grade --
 * N`) and apply its review file; otherwise a side has no rows. With a floor, prints the
 * verdict of the angle rule in docs/SEASONS.md.
 */
import { db } from "../src/db/client";
import { agentRunRows } from "../src/db/agent-runs";
import { getWave } from "../src/db/waves";
import { splitByProvenance } from "../src/derive/benchmark";
import { agreementWithInterval, angleVerdict, controlReadout } from "../src/derive/season-compare";

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
const a = Number(flag("wave"));
const b = Number(flag("against"));
if (!a || !b) { console.error("usage: compare-seasons.mts --wave N --against M [--floor-lo X --floor-hi Y]"); process.exit(2); }

const d = db();
const excluded = flag("exclude-frame");
const rowsOf = (id: number) => splitByProvenance(agentRunRows(d, id).filter((r) => r.status !== "error"))
  .usable.filter((r) => r.frame !== excluded);
const ra = rowsOf(a);
const rb = rowsOf(b);
const r = agreementWithInterval(ra, rb);
const pct = (x: number) => `${Math.round(x * 100)}%`;

console.log(`wave ${a} "${getWave(d, a)?.name}" (${ra.length} runs)`);
console.log(`against wave ${b} "${getWave(d, b)?.name}" (${rb.length} runs)${excluded ? ` · frame ${excluded} excluded` : ""}\n`);
console.log(`cell majorities agreeing: ${r.agreeing} of ${r.comparable}` +
  (r.rate !== null ? ` = ${pct(r.rate)}` : "") +
  (r.interval ? ` · 95% interval ${pct(r.interval.lo)} to ${pct(r.interval.hi)} (repositories resampled, paired)` : ""));
console.log(`not compared: ${r.noMajority.length} cell(s) with no majority on one side · ${r.unmatched} unmatched`);
// Printed oldest first: what the cell was in the --against wave, then what it became.
for (const x of r.disagreements) console.log(`  ${x.target} × ${x.frame}: wave ${b} ${x.b} → wave ${a} ${x.a}`);

const lo = flag("floor-lo"), hi = flag("floor-hi");
if (lo && hi) console.log(`\nangle rule: ${angleVerdict(r.rate, { lo: Number(lo), hi: Number(hi) })}`);

// The control: one run per cell of the --against wave's model on the --wave wave's CLI.
const c = Number(flag("control"));
if (c) {
  const rc = rowsOf(c);
  const x = controlReadout(rc, rb, ra);
  console.log(`\ncontrol wave ${c} "${getWave(d, c)?.name}" (${rc.length} runs)`);
  console.log(`of ${x.changed.length} changed cells: ${x.sideS0} like wave ${b} · ${x.sideS1} like wave ${a} · ${x.neither} like neither` +
    (x.missing ? ` · ${x.missing} with no gradeable control run` : ""));
  for (const y of x.changed) console.log(`  ${y.target} × ${y.frame}: wave ${b} ${y.s0} → wave ${a} ${y.s1} · control ${y.control ?? "missing"}`);
  console.log(`over every cell: control matches wave ${b}'s majority on ${x.matchS0.matching} of ${x.matchS0.cells}, wave ${a}'s on ${x.matchS1.matching} of ${x.matchS1.cells}`);
  console.log(`control rule: ${x.verdict}`);
}
