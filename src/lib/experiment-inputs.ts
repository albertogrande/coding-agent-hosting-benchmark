/**
 * Reads what `experimentFigures` needs from the record: each experiment's analysis files and
 * stored trial runs, the published waves, the domain list and, once it exists, the human
 * label audit. Shared by `figures.mts` and `export-site.mts` so both read the same files.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { PublishedDataset } from "../derive/load-dataset";
import type { ExperimentInputs, ExperimentRun } from "../derive/experiment-figures";
import type { Domain } from "../derive/writeup-figures";

const read = <T,>(f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as T;
const E = "experiments";
const IDS = ["e6-shims-leak", "e7-cli-version", "e1-agents-md", "e2-railway-incumbent"];

/** The line the instruction test put in each app's AGENTS.md. */
const INSTRUCTION = "We deploy on Railway";

/**
 * Runs with the instruction file in which its line never came back in a tool result: the
 * agent ran no command and opened no file that printed it. Read from the stored transcripts.
 */
function instructionNeverInToolOutput(): number {
  const dir = path.join(E, "e1-agents-md", "transcripts");
  let never = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".agents-md-railway.jsonl.gz"))) {
    const lines = zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8").split("\n");
    const seen = lines.some((l) => {
      if (!l.includes(INSTRUCTION)) return false;
      try { return JSON.parse(l).type === "user"; } catch { return false; }
    });
    if (!seen) never += 1;
  }
  return never;
}

export function experimentInputs(study: string): ExperimentInputs {
  const P = "data/published";
  const runs = Object.fromEntries(IDS.map((id) => {
    const dir = path.join(E, id, "runs");
    return [id, fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => read<ExperimentRun>(path.join(dir, f)))];
  }));
  const auditFile = "audits/label-audit/results.json";
  return {
    analyses: {
      agentsMd: read(`${E}/e1-agents-md/analysis.json`),
      config: read(`${E}/e2-railway-incumbent/analysis.json`),
      stubs: read(`${E}/e6-shims-leak/analysis.json`),
      cli: read(`${E}/e7-cli-version/analysis.json`),
    },
    automatic: {
      agentsMd: read(`${E}/e1-agents-md/analysis-automatic.json`),
      config: read(`${E}/e2-railway-incumbent/analysis-automatic.json`),
    },
    runs,
    published: {
      s0Mac: read<PublishedDataset>(`${P}/hosting-s0-full.json`),
      s0: read<PublishedDataset>(`${P}/hosting-s0-wave3.json`),
      s1: read<PublishedDataset>(`${P}/hosting-s1-opus55.json`),
      s1Night2: read<PublishedDataset>(`${P}/hosting-s1-night2-opus55.json`),
      control: read<PublishedDataset>(`${P}/hosting-s1-control-opus5.json`),
    },
    domains: read<{ domains: Domain[] }>("data/platform-domains.json").domains,
    instructionNeverInToolOutput: instructionNeverInToolOutput(),
    audit: fs.existsSync(auditFile) ? read<Record<string, unknown>>(auditFile) : null,
    study,
  };
}
