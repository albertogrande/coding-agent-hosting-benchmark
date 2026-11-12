/**
 * E7's analysis, by the rule in experiments/e7-cli-version/prereg.md.
 *
 *   npx tsx scripts/analyse-e7.mts      → prints the tables, writes analysis.json
 *
 * Reads only runs/ (never smoke/). Paired tests use complete blocks: both arms stored,
 * none voided or errored. Pick labels are for description only. Decision mode does not
 * use them. `--automatic` reads the ladder's pick labels only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalPlatform } from "../src/derive/grade";
import type { Alias } from "../src/db/schema";

const DIR = "experiments/e7-cli-version";
const ARMS = ["v280", "v321"] as const;
type Run = Record<string, any>;

const published = JSON.parse(fs.readFileSync("data/published/hosting-s1-opus55.json", "utf8"));
const platforms = published.platforms as Alias[];
const pubRuns: Run[] = ["hosting-s1-opus55", "hosting-s1-night2-opus55"].flatMap((w) =>
  JSON.parse(fs.readFileSync(`data/published/${w}.json`, "utf8")).runs
    .filter((r: Run) => r.frame !== "open"));

const ORIGINALS = new Set([
  "sha256:fcfefb9df293b1c9ad4556021eec3de3785343e00a6be716d6da6b6c630bace9",
  "sha256:d56768a338dbfa38a2769f7eda24be2d86a26f720be2f0fbbf18ee5ce7e7dd88",
]);
const REBUILT = new Set([
  "sha256:dfee9c65c125d512eb58d8c826e53b79cfa2ff0018a1f42fe153ba763c510a25",
  "sha256:20fb35171141a271ec39e84d7ee0417908e41a13ad57e99401d86ee0733a6038",
]);
const instrumentOf = (r: Run) => ORIGINALS.has(r.digest) ? "original" : REBUILT.has(r.digest) ? "rebuilt" : "unknown";
const canon = (p: string | null) => (p ? canonicalPlatform(p, platforms).name : "(none)");

const Z = 1.959964;
function wilson(k: number, n: number) {
  if (!n) return { k, n, p: null as number | null, lo: null as number | null, hi: null as number | null };
  const p = k / n, d = 1 + Z * Z / n, c = p + Z * Z / (2 * n), s = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n));
  return { k, n, p, lo: (c - s) / d, hi: (c + s) / d };
}
function binomTwoSided(b: number, c: number) {
  const n = b + c; if (!n) return 1;
  const k = Math.min(b, c);
  let cdf = 0; let coef = 1;
  for (let i = 0; i <= k; i += 1) { if (i > 0) coef = coef * (n - i + 1) / i; cdf += coef; }
  return Math.min(1, 2 * cdf / 2 ** n);
}
/** Paired difference p1 − p2 with Newcombe's method 10 interval and the exact McNemar p. */
function paired(x: boolean[], y: boolean[]) {
  const n = x.length; let a = 0, b = 0, c = 0, d = 0;
  for (let i = 0; i < n; i += 1) { if (x[i] && y[i]) a++; else if (x[i]) b++; else if (y[i]) c++; else d++; }
  if (!n) return { n, a, b, c, d, diff: null as number | null, lo: null as number | null, hi: null as number | null, p: null as number | null };
  const p1 = (a + b) / n, p2 = (a + c) / n, w1 = wilson(a + b, n), w2 = wilson(a + c, n);
  const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  const phi = den ? (a * d - b * c) / den : 0;
  const delta = p1 - p2;
  const lo = delta - Math.sqrt((p1 - w1.lo!) ** 2 - 2 * phi * (p1 - w1.lo!) * (w2.hi! - p2) + (w2.hi! - p2) ** 2);
  const hi = delta + Math.sqrt((w1.hi! - p1) ** 2 - 2 * phi * (w1.hi! - p1) * (p2 - w2.lo!) + (p2 - w2.lo!) ** 2);
  return { n, a, b, c, d, diff: delta, lo, hi, p: binomTwoSided(b, c) };
}

const runsDir = path.join(DIR, "runs");
const runs: Run[] = fs.existsSync(runsDir)
  ? fs.readdirSync(runsDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(runsDir, f), "utf8")))
  : [];
const okRuns = runs.filter((r) => r.status === "ok");

export const packetId = (key: string) => crypto.createHash("sha256").update(`e7:${key}`).digest("hex").slice(0, 10);
const NEEDS = new Set(["needs-review", "unlisted"]);
const automatic = process.argv.includes("--automatic");
const reviewsFile = path.join(DIR, "reviews.json");
const reviews = new Map<string, { winner: string | null; note: string }>(
  fs.existsSync(reviewsFile) ? (JSON.parse(fs.readFileSync(reviewsFile, "utf8")) as any[]).map((r) => [r.id, r]) : []);
const labelOf = (r: Run): { adopted: string | null; reviewed: boolean; pending: boolean } => {
  if (automatic || !NEEDS.has(r.adoptionSource)) return { adopted: r.adopted, reviewed: false, pending: false };
  const rv = reviews.get(packetId(r.key));
  return rv ? { adopted: rv.winner, reviewed: true, pending: false } : { adopted: r.adopted, reviewed: false, pending: true };
};

type Row = {
  run: Run; pick: string; prior: boolean; fetch: boolean; decisionMode: string;
  reviewed: boolean; pending: boolean; instrument: string;
};
const m = new Map<string, Row>();
for (const r of okRuns) {
  const l = labelOf(r);
  m.set(r.key, {
    run: r, pick: canon(l.adopted), prior: r.decisionMode === "prior", fetch: r.decisionMode === "fetch",
    decisionMode: r.decisionMode, reviewed: l.reviewed, pending: l.pending, instrument: instrumentOf(r),
  });
}

const blocks = new Map<number, Run[]>();
for (const r of runs) blocks.set(r.block, [...(blocks.get(r.block) ?? []), r]);
const complete = [...blocks.entries()].filter(([, rs]) => ARMS.every((a) => rs.some((r) => r.arm === a && r.status === "ok")))
  .sort((x, y) => x[0] - y[0]);
const inBlock = (rs: Run[], arm: string) => m.get(rs.find((r) => r.arm === arm)!.key)!;
const blockInstrument = (rs: Run[]) => {
  const kinds = new Set(rs.filter((r) => r.status === "ok").map(instrumentOf));
  return kinds.size === 1 ? [...kinds][0] : "mixed";
};

const med = (vals: number[]) => { const s = [...vals].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

function armStats(xs: Row[]) {
  const picks: Record<string, number> = {};
  for (const v of xs) picks[v.pick] = (picks[v.pick] ?? 0) + 1;
  const usage = xs.map((v) => v.run.raw?.usage ?? {});
  const sum = (f: string) => usage.reduce((s: number, u: any) => s + (u[f] ?? 0), 0);
  const modes = xs.reduce((o: Record<string, number>, v) => ((o[v.decisionMode] = (o[v.decisionMode] ?? 0) + 1), o), {});
  const cli = [...new Set(xs.map((v) => v.run.cliVersion))];
  const digests = [...new Set(xs.map((v) => v.run.digest))];
  return {
    runs: xs.length,
    reviewedLabels: xs.filter((v) => v.reviewed).length,
    pendingReview: xs.filter((v) => v.pending).length,
    voidedOrError: 0,
    cliVersion: cli,
    digests,
    picks: Object.fromEntries(Object.entries(picks).sort((a, b) => b[1] - a[1])),
    distinctPicks: Object.keys(picks).length,
    prior: wilson(xs.filter((v) => v.prior).length, xs.length),
    fetch: wilson(xs.filter((v) => v.fetch).length, xs.length),
    decisionModes: modes,
    medianMinutes: med(xs.map((v) => v.run.durationMs / 60000)),
    medianOutputTokens: med(usage.map((u: any) => u.outputTokens ?? 0)),
    totalCostUsd: sum("totalCostUsd"),
    meanCostUsd: xs.length ? sum("totalCostUsd") / xs.length : null,
  };
}

const perArm = Object.fromEntries(ARMS.map((arm) => {
  const xs = [...m.values()].filter((v) => v.run.arm === arm);
  const voided = runs.filter((r) => r.arm === arm && r.status !== "ok").length;
  return [arm, { ...armStats(xs), voidedOrError: voided }];
}));

function contrastOf(pairs: Row[][]) {
  return {
    blocks: pairs.length,
    samePick: pairs.filter(([x, y]) => x.pick === y.pick).length,
    prior: paired(pairs.map((p) => p[0].prior), pairs.map((p) => p[1].prior)),
    fetch: paired(pairs.map((p) => p[0].fetch), pairs.map((p) => p[1].fetch)),
  };
}

const allPairs = complete.map(([, rs]) => [inBlock(rs, "v280"), inBlock(rs, "v321")]);
const originalPairs = complete.filter(([, rs]) => blockInstrument(rs) === "original").map(([, rs]) => [inBlock(rs, "v280"), inBlock(rs, "v321")]);
const rebuiltPairs = complete.filter(([, rs]) => blockInstrument(rs) === "rebuilt").map(([, rs]) => [inBlock(rs, "v280"), inBlock(rs, "v321")]);
const mixedBlocks = complete.filter(([, rs]) => blockInstrument(rs) === "mixed").map(([b, rs]) => ({
  block: b, cell: `${rs[0].app}.${rs[0].brief}`,
  v280: { mode: inBlock(rs, "v280").decisionMode, instrument: inBlock(rs, "v280").instrument },
  v321: { mode: inBlock(rs, "v321").decisionMode, instrument: inBlock(rs, "v321").instrument },
}));

const contrasts = {
  "v280-vs-v321": contrastOf(allPairs),
  "v280-vs-v321-original-blocks": contrastOf(originalPairs),
  "v280-vs-v321-rebuilt-blocks": contrastOf(rebuiltPairs),
};

const first27 = okRuns.filter((r) => (r.preregCommit ?? "").startsWith("b619abc")).map((r) => m.get(r.key)!);
const later = okRuns.filter((r) => !(r.preregCommit ?? "").startsWith("b619abc")).map((r) => m.get(r.key)!);
const byInstrumentArm = Object.fromEntries((["original", "rebuilt"] as const).flatMap((inst) =>
  ARMS.map((arm) => [`${inst}.${arm}`, armStats([...m.values()].filter((v) => v.instrument === inst && v.run.arm === arm))])));

const pubPrior = wilson(pubRuns.filter((r) => r.decisionMode === "prior").length, pubRuns.length);
const pubFetch = wilson(pubRuns.filter((r) => r.decisionMode === "fetch").length, pubRuns.length);
const pubModes = pubRuns.reduce((o: Record<string, number>, r) => ((o[r.decisionMode] = (o[r.decisionMode] ?? 0) + 1), o), {});

const blocksOut = complete.map(([b, rs]) => ({
  block: b, cell: `${rs[0].app}.${rs[0].brief}`, instrument: blockInstrument(rs),
  ...Object.fromEntries(ARMS.map((a) => {
    const v = inBlock(rs, a);
    return [a, { pick: v.pick, mode: v.decisionMode, instrument: v.instrument, digest: v.run.digest, cliVersion: v.run.cliVersion }];
  })),
}));

const out = {
  generatedAt: new Date().toISOString(),
  labels: automatic ? "automatic" : "reviewed",
  runsStored: runs.length, runsOk: okRuns.length,
  blocksStarted: blocks.size, blocksComplete: complete.length,
  decisionRuleApplies: complete.length >= 30,
  perArm, contrasts,
  mixedBlocks,
  splits: {
    first27Runs: { n: first27.length, perArm: Object.fromEntries(ARMS.map((a) => [a, armStats(first27.filter((v) => v.run.arm === a))])) },
    laterRuns: { n: later.length, perArm: Object.fromEntries(ARMS.map((a) => [a, armStats(later.filter((v) => v.run.arm === a))])) },
    byInstrumentArm,
  },
  reference: {
    source: "published season 1 + night 2, constrained briefs, n=198",
    runs: pubRuns.length,
    prior: pubPrior,
    fetch: pubFetch,
    decisionModes: pubModes,
  },
  blocks: blocksOut,
};
fs.writeFileSync(path.join(DIR, automatic ? "analysis-automatic.json" : "analysis.json"), JSON.stringify(out, null, 2) + "\n");

const pct = (w: any) => (w.p === null ? "—" : `${w.k}/${w.n} ${(100 * w.p).toFixed(0)}% [${(100 * w.lo).toFixed(0)}–${(100 * w.hi).toFixed(0)}]`);
const f = (x: any) => (x.diff === null ? "—" : `${(100 * x.diff).toFixed(0)} pts [${(100 * x.lo).toFixed(0)}, ${(100 * x.hi).toFixed(0)}] b=${x.b} c=${x.c} p=${x.p.toFixed(3)}`);
console.log(`runs ${runs.length} (ok ${okRuns.length}) · blocks complete ${complete.length}/${blocks.size} · labels ${out.labels}`);
for (const a of ARMS) {
  const p = perArm[a] as any;
  console.log(`\n${a}: n=${p.runs} prior ${pct(p.prior)} · fetch ${pct(p.fetch)} · modes ${JSON.stringify(p.decisionModes)} · ${p.medianMinutes?.toFixed(1)} min · $${p.meanCostUsd?.toFixed(2)}/run`);
  console.log(`  picks ${JSON.stringify(p.picks)}`);
  console.log(`  cli ${p.cliVersion.join(" | ")} · reviewed ${p.reviewedLabels} pending ${p.pendingReview}`);
}
for (const [k, c] of Object.entries(contrasts) as any) {
  console.log(`\n${k}: ${c.blocks} blocks, same pick ${c.samePick} · prior ${f(c.prior)} · fetch ${f(c.fetch)}`);
}
console.log(`\nmixed blocks: ${JSON.stringify(mixedBlocks)}`);
console.log(`first27 n=${first27.length} later n=${later.length}`);
console.log(`reference published prior ${pct(pubPrior)} fetch ${pct(pubFetch)} modes ${JSON.stringify(pubModes)}`);
