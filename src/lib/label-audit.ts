/**
 * The human label audit: who is in the sample, and what the auditor is shown.
 *
 * Every pick in this record was labelled by a script, and the runs the script could not
 * settle were read by models. No person had checked a label. The audit draws 60 runs with
 * a fixed seed, shows each to a person without its label, and counts how often the person's
 * pick is the recorded one. `audits/label-audit/README.md` holds the rule, committed before
 * the first run was labelled.
 */
import fs from "node:fs";
import path from "node:path";
import { NONE, reviewedPicks } from "../derive/experiment-figures";
import { BRIEF_OPENING } from "../derive/site-export";

export const SEED = 20261118;
export const PER_STRATUM = 20;
export const DIR = "audits/label-audit";

export type Candidate = {
  /** Where the run is stored. */
  source: string;
  key: string;
  stratum: "published" | "reviewer" | "script";
  label: string | null;
  app: string;
  brief: string;
  changedFiles: string[];
  timeline: { tool: string; detail?: string }[];
  closing: string;
};

const read = <T,>(f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as T;

/** mulberry32: a small seeded generator, so the draw is the same on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(xs: T[], next: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const PUBLISHED = ["hosting-s0-full", "hosting-s0-wave3", "hosting-s1-opus55", "hosting-s1-night2-opus55", "hosting-s1-control-opus5"];
const EXPERIMENTS: [string, string[]][] = [
  ["e6-shims-leak", ["named", "neutral", "none"]],
  ["e7-cli-version", ["v280", "v321"]],
  ["e1-agents-md", ["control", "agents-md-railway"]],
  ["e2-railway-incumbent", ["control", "railway-incumbent"]],
];

/** Every labelled run in the record, in a fixed order. */
export function candidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const w of PUBLISHED) {
    for (const r of read<{ runs: any[] }>(`data/published/${w}.json`).runs) {
      out.push({
        source: `data/published/${w}.json`, key: `${w}:${r.runId}`, stratum: "published", label: r.adopted ?? null,
        app: r.repository.id, brief: r.frame, changedFiles: r.changedFiles ?? [], timeline: r.toolTimeline ?? [], closing: r.closingMessage ?? "",
      });
    }
  }
  for (const [id, arms] of EXPERIMENTS) {
    const picks = reviewedPicks(read(`experiments/${id}/analysis.json`), arms);
    const dir = `experiments/${id}/runs`;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const r = read<any>(path.join(dir, f));
      const byReviewer = ["needs-review", "unlisted"].includes(r.adoptionSource);
      out.push({
        source: `${dir}/${f}`, key: `${id}:${r.key}`, stratum: byReviewer ? "reviewer" : "script", label: picks.get(r.key) ?? null,
        app: r.app, brief: r.brief, changedFiles: r.changedFiles ?? [], timeline: r.toolTimeline ?? [], closing: r.text ?? "",
      });
    }
  }
  return out;
}

/** The 60 runs, 20 per stratum, in the order the auditor sees them. */
export function drawSample(all: Candidate[] = candidates()): (Candidate & { id: string })[] {
  const next = rng(SEED);
  const picked = (["published", "reviewer", "script"] as const).flatMap((s) =>
    shuffled(all.filter((c) => c.stratum === s).sort((a, b) => a.key.localeCompare(b.key)), next).slice(0, PER_STRATUM));
  return shuffled(picked, next).map((c, i) => ({ ...c, id: `run-${String(i + 1).padStart(2, "0")}` }));
}

/** The hosts the record has ever labelled a pick with, for the auditor's list. */
export function hostOptions(all: Candidate[] = candidates()): string[] {
  return [...new Set(all.map((c) => c.label).filter((l): l is string => !!l && l !== NONE))].sort((a, b) => a.localeCompare(b));
}

const DEPLOY = /\b(flyctl|fly|railway|render|vercel|netlify|wrangler|gcloud|heroku|koyeb|doctl|az|aws|eb|kamal|dokku|docker|ssh|scp|rsync)\b/;

/** What the auditor sees of one run. The label and the labelling evidence are left out. */
export function packetItem(c: Candidate & { id: string }) {
  const writes = c.timeline.filter((e) => ["Write", "Edit", "MultiEdit"].includes(e.tool)).map((e) => (e.detail ?? "").slice(0, 200));
  const commands = c.timeline.filter((e) => e.tool === "Bash" && DEPLOY.test(e.detail ?? "")).map((e) => (e.detail ?? "").slice(0, 400));
  return {
    id: c.id,
    app: c.app,
    brief: BRIEF_OPENING[c.brief] ?? c.brief,
    changedFiles: c.changedFiles,
    writes: [...new Set(writes)],
    commands,
    closing: c.closing,
  };
}
