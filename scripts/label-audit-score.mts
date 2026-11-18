/**
 * Scores the label audit by the rule in `audits/label-audit/README.md`.
 *
 *   npx tsx scripts/label-audit-score.mts [path/to/answers.json]
 *
 * Reads the auditor's answers, compares each with the recorded label, and writes
 * `results.json` (which `npm run export-site` puts in the page's data) and `results.md`.
 */
import fs from "node:fs";
import path from "node:path";
import { NONE, wilson } from "../src/derive/experiment-figures";
import { DIR, drawSample } from "../src/lib/label-audit";

const file = process.argv[2] ?? path.join(DIR, "answers.json");
const { answers, labelledAt } = JSON.parse(fs.readFileSync(file, "utf8")) as { labelledAt: string; answers: Record<string, { pick: string; note?: string }> };
if (path.resolve(file) !== path.resolve(DIR, "answers.json")) fs.copyFileSync(file, path.join(DIR, "answers.json"));

const sample = drawSample();
const missing = sample.filter((c) => !answers[c.id]).map((c) => c.id);
if (missing.length) throw new Error(`not labelled yet: ${missing.join(", ")}`);

const norm = (s: string | null) => (s === null || s === NONE || s === "No outside host" ? "no outside host" : s.trim().toLowerCase());
const rows = sample.map((c) => {
  const a = answers[c.id];
  const verdict = a.pick === "Cannot tell" ? "cannot tell" : norm(a.pick) === norm(c.label) ? "agrees" : "disagrees";
  return { id: c.id, stratum: c.stratum, source: c.source, recorded: c.label ?? "No outside host", auditor: a.pick, note: a.note ?? "", verdict };
});
const tally = (rs: typeof rows) => ({
  runs: rs.length,
  agrees: wilson(rs.filter((r) => r.verdict === "agrees").length, rs.length),
  disagrees: rs.filter((r) => r.verdict === "disagrees").length,
  cannotTell: rs.filter((r) => r.verdict === "cannot tell").length,
});
const GROUPS: [string, string][] = [
  ["published", "September and October, every published run"],
  ["reviewer", "November, labelled by the automated reviewer"],
  ["script", "November, labelled by the script alone"],
];
const results = {
  labelledAt,
  auditor: "the author of the benchmark, without the recorded labels",
  all: tally(rows),
  groups: GROUPS.map(([id, label]) => ({ id, label, ...tally(rows.filter((r) => r.stratum === id)) })),
  notAgreeing: rows.filter((r) => r.verdict !== "agrees"),
};
fs.writeFileSync(path.join(DIR, "results.json"), JSON.stringify(results, null, 2) + "\n");

const line = (t: ReturnType<typeof tally>) => `${t.agrees.n} of ${t.agrees.of} (${t.agrees.pct}%, ${t.agrees.lo} to ${t.agrees.hi}%)`;
const md = [
  "# Label audit: results", "",
  `Labelled ${labelledAt.slice(0, 10)}, scored by the rule in \`README.md\`.`, "",
  `The auditor's pick was the recorded pick in **${line(results.all)}** of the 60 runs.`, "",
  "| Group | Agrees | Disagrees | Cannot tell |", "|---|---|---|---|",
  ...results.groups.map((g) => `| ${g.label} | ${line(g)} | ${g.disagrees} | ${g.cannotTell} |`), "",
  "## Runs that did not agree", "",
  ...(results.notAgreeing.length
    ? ["| Run | Stored at | Recorded | Auditor | Note |", "|---|---|---|---|---|", ...results.notAgreeing.map((r) => `| ${r.id} | \`${r.source}\` | ${r.recorded} | ${r.auditor} | ${r.note.replace(/\|/g, "/").replace(/\n/g, " ")} |`)]
    : ["None."]), "",
  "No label in the record was changed.", "",
].join("\n");
fs.writeFileSync(path.join(DIR, "results.md"), md);
console.log(md);
