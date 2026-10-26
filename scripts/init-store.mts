/**
 * Creates the store a new season plans against: the `hosting` project and its four briefs.
 *
 *   npm run init
 *   npm run plan -- waves/hosting-s1-opus55.json
 *
 * The project's platform list is the one the last season published, in the order the grader
 * reads it, so a new season names platforms the way the published ones did. The briefs are
 * `prompts/hosting-s0.json`, as run. `AEO_DB` picks the store file, as everywhere else.
 */
import fs from "node:fs";
import { db } from "../src/db/client";
import { createProject, getProject } from "../src/db/repo";
import { savePromptSet } from "../src/db/waves";
import { importPromptSet } from "../src/lib/import-prompts";
import { catalogueOf } from "../src/derive/season-factpack";
import type { PublishedDataset } from "../src/derive/load-dataset";

const SLUG = "hosting";
const LAST_SEASON = "data/published/hosting-s1-opus55.json";
const BRIEFS = "prompts/hosting-s0.json";

const d = db();
if (getProject(d, SLUG)) {
  console.error(`project '${SLUG}' already exists in this store. Point AEO_DB at a new file to start over.`);
  process.exit(1);
}

const last = JSON.parse(fs.readFileSync(LAST_SEASON, "utf8")) as PublishedDataset;
const competitors = catalogueOf(last).map((p) => ({
  name: p.name,
  aliases: [...p.aliases],
  domains: [...(p.domains ?? [])],
  ...(p.caseSensitive ? { caseSensitive: true } : {}),
}));
const project = createProject(d, { slug: SLUG, name: "Hosting", competitors, domains: [], categories: [] });
const set = savePromptSet(d, project.id, importPromptSet(JSON.parse(fs.readFileSync(BRIEFS, "utf8"))));

console.log(`created project '${project.slug}' with ${competitors.length} platforms and prompt set '${set.version}'`);
console.log(`next: npm run plan -- waves/hosting-s1-opus55.json`);
