/**
 * Takes people's email addresses out of the stored experiments.
 *
 *   npx tsx scripts/redact-experiments.mts [--check]
 *
 * The harness stripped login tokens as it stored each run and transcript, and nothing else.
 * A transcript holds whatever the agent printed, and `git log` on a fork prints its authors.
 * So ten personal addresses sat in the November record. The published seasons had theirs
 * removed from closing messages (`src/lib/redact.ts`); this applies the same shape to every
 * string of `experiments/<id>/runs`, `smoke` and `transcripts`, and to `data/published`:
 * the local part of the address, and the name beside it in a git identity, are replaced and
 * the domain is kept.
 *
 * It is narrower than `redact()` on purpose. A transcript is full of strings shaped like an
 * address that are code or placeholders (`@app.route`, `you@example.com`, a database URL),
 * and replacing those would damage the record. Only addresses at a personal mailbox are
 * touched: the webmail providers and the three personal domains found in these files.
 * GitHub's `users.noreply.github.com` handles and company contact addresses are left.
 * `--check` counts and writes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { REDACTED } from "../src/lib/redact";

const PERSONAL = "gmail\\.com|googlemail\\.com|outlook\\.com|hotmail\\.com|live\\.com|yahoo\\.[a-z.]+|icloud\\.com|me\\.com|proton(?:mail)?\\.[a-z]+|pm\\.me|gmx\\.[a-z]+|fastmail\\.[a-z]+|matteocollina\\.com|armand\\.philippot\\.eu|jakecooper\\.me";
const IDENTITY = new RegExp(`([^\\s<>\`"\\\\][^<>\`"\\\\\\n]{0,60}?)\\s+<([A-Za-z0-9._%+-]+)@(${PERSONAL})>`, "gi");
const BARE = new RegExp(`([A-Za-z0-9._%+-]+)@(${PERSONAL})(?![A-Za-z0-9.-])`, "gi");
const DONE = REDACTED.slice(1, -1);

function redact(input: string): { text: string; count: number } {
  let count = 0;
  let text = input.replace(IDENTITY, (whole, name: string, local: string, domain: string) =>
    name === REDACTED && local === DONE ? whole : (count += 1, `${REDACTED} <${REDACTED}@${domain}>`));
  text = text.replace(BARE, (whole, local: string, domain: string) => (local === DONE ? whole : (count += 1, `${REDACTED}@${domain}`)));
  return { text, count };
}

const check = process.argv.includes("--check");
let total = 0;

function walk(v: unknown): unknown {
  if (typeof v === "string") {
    const r = redact(v);
    total += r.count;
    return r.text;
  }
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  return v;
}

const files: string[] = [];
const collect = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (/\.(json|jsonl\.gz)$/.test(p) && (dir.startsWith("data") || /\/(runs|smoke|transcripts)(\/|$)/.test(p))) files.push(p);
  }
};
collect("experiments");
collect("data/published");

let touched = 0;
for (const f of files.sort()) {
  const before = total;
  if (f.endsWith(".gz")) {
    const lines = zlib.gunzipSync(fs.readFileSync(f)).toString("utf8").split("\n");
    const out = lines.map((l) => {
      if (!l.trim()) return l;
      try { return JSON.stringify(walk(JSON.parse(l))); } catch { const r = redact(l); total += r.count; return r.text; }
    });
    if (total > before && !check) fs.writeFileSync(f, zlib.gzipSync(out.join("\n")));
  } else {
    const raw = fs.readFileSync(f, "utf8");
    const out = walk(JSON.parse(raw));
    const indent = /^\{\n {2}"/.test(raw) ? 2 : undefined;
    if (total > before && !check) fs.writeFileSync(f, JSON.stringify(out, null, indent) + (raw.endsWith("\n") ? "\n" : ""));
  }
  if (total > before) touched += 1;
}
console.log(`${check ? "would redact" : "redacted"} ${total} value(s) in ${touched} of ${files.length} files`);
