/**
 * Writes the two data files the case study "How Claude Code picks a host" computes every
 * figure from. Nothing is graded, loaded or called: both files are the record, reshaped.
 *
 *   npm run export-site -- [--out out/site]
 *
 * `runs.json` is every run of the two published seasons (`src/derive/site-export.ts`).
 * `experiments.json` is every November figure, from each experiment's analysis file and
 * stored runs (`src/derive/experiment-figures.ts`).
 *
 * The page serves both under thebeat.dev/research/how-claude-code-picks-a-host/. A reader
 * who runs this on a clean clone gets the same bytes; the sha256 it prints is the check.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PublishedDataset } from "../src/derive/load-dataset";
import { experimentFigures } from "../src/derive/experiment-figures";
import { siteDataset } from "../src/derive/site-export";
import { experimentInputs } from "../src/lib/experiment-inputs";

export const STUDY = "https://thebeat.dev/research/how-claude-code-picks-a-host/";

const argv = process.argv.slice(2);
const i = argv.indexOf("--out");
const out = path.resolve(i === -1 ? "out/site" : argv[i + 1]);

const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as PublishedDataset;
const seasons = ["data/published/hosting-s0-wave3.json", "data/published/hosting-s1-opus55.json"].map(read);
const site = siteDataset(seasons, STUDY);
const experiments = experimentFigures(experimentInputs(STUDY));

fs.mkdirSync(out, { recursive: true });
const write = (name: string, value: unknown, what: string) => {
  const body = JSON.stringify(value);
  fs.writeFileSync(path.join(out, name), body);
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  console.log(`wrote ${path.relative(process.cwd(), path.join(out, name))}: ${what}, sha256 ${sha}`);
};
write("runs.json", site, `${site.count} runs, grader ${site.grader}`);
write("experiments.json", experiments, `${experiments.record.runs} runs in the record, ${experiments.unchanged.runs} unchanged November runs`);
