/**
 * Creates the email project in a store: its provider catalogue and its three prompt sets.
 *
 *   npm run init:email
 *   npm run plan -- waves/email-s4-open.json
 *
 * The catalogue is `EMAIL_CATALOGUE` (`src/derive/email/vendors.ts`), with the domains each
 * provider owns, so the preflight's ownership and branding checks run against it. The briefs
 * are `prompts/email-s0.json`, cut into the three sets the waves plan against. The store may
 * already hold the hosting project; the two never share a grade. `AEO_DB` picks the file.
 */
import fs from "node:fs";
import { db } from "../src/db/client";
import { createProject, getProject } from "../src/db/repo";
import { savePromptSet } from "../src/db/waves";
import { EMAIL_PROJECT } from "../src/db/email-grades";
import { EMAIL_CATALOGUE } from "../src/derive/email/vendors";
import { EMAIL_BRIEFS, emailPromptSets } from "../src/derive/email/prompt-sets";

const d = db();
if (getProject(d, EMAIL_PROJECT)) {
  console.error(`project '${EMAIL_PROJECT}' already exists in this store. Point AEO_DB at a new file to start over.`);
  process.exit(1);
}

const project = createProject(d, { slug: EMAIL_PROJECT, name: "Email", competitors: EMAIL_CATALOGUE, domains: [], categories: [] });
for (const set of emailPromptSets(JSON.parse(fs.readFileSync(EMAIL_BRIEFS, "utf8")))) {
  savePromptSet(d, project.id, set);
  console.log(`prompt set '${set.version}': ${set.prompts.map((p) => p.key).join(", ")}`);
}
console.log(`created project '${project.slug}' with ${EMAIL_CATALOGUE.length} providers`);
console.log(`next: npm run scaffolds, then npm run plan -- waves/email-s4-open.json`);
