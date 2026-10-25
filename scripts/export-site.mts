/**
 * Writes `runs.json`, the dataset the case study "Memory first, docs second" computes every
 * figure from, out of the two published seasons. Nothing is graded, loaded or called: the
 * file is the published record, reshaped (`src/derive/site-export.ts`).
 *
 *   npm run export-site -- [--out out/site/runs.json]
 *
 * The page serves the file at thebeat.dev/research/memory-first-docs-second/runs.json. A
 * reader who runs this on a clean clone gets the same bytes; the sha256 it prints is the check.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PublishedDataset } from "../src/derive/load-dataset";
import { siteDataset } from "../src/derive/site-export";

const argv = process.argv.slice(2);
const i = argv.indexOf("--out");
const out = path.resolve(i === -1 ? "out/site/runs.json" : argv[i + 1]);

const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as PublishedDataset;
const seasons = ["data/published/hosting-s0-wave3.json", "data/published/hosting-s1-opus55.json"].map(read);
const site = siteDataset(seasons, "https://thebeat.dev/research/memory-first-docs-second/");

const body = JSON.stringify(site);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
const sha = crypto.createHash("sha256").update(body).digest("hex");
console.log(`wrote ${path.relative(process.cwd(), out)}: ${site.count} runs, grader ${site.grader}, sha256 ${sha}`);
