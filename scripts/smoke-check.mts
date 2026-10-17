/**
 * Reads the first runs of a wave against its pins and against a baseline wave, before the
 * rest of the night is committed. See src/derive/smoke.ts.
 *
 *   npm run run-wave -- --wave N --limit 3
 *   npm run smoke-check -- --wave N --against 3
 *
 * Exits 1 on any failure. A warning is for a person to read, then decide.
 */
import { inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { runs } from "../src/db/schema";
import { surfacesOf, waveRows } from "../src/db/waves";
import { initInventory, smokeFindings, thinkingTokens, type SmokeRun } from "../src/derive/smoke";
import { sandboxOf } from "../src/runner/sandbox";

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
const waveId = Number(flag("wave"));
const baseId = Number(flag("against"));
if (!waveId || !baseId) { console.error("usage: smoke-check.mts --wave N --against M"); process.exit(2); }

const d = db();
const load = (id: number): SmokeRun[] => {
  const rows = waveRows(d, id);
  const raw = new Map(d.select({ id: runs.id, raw: runs.rawResponse }).from(runs)
    .where(inArray(runs.id, rows.map((r) => r.runId))).all().map((r) => [r.id, r.raw]));
  return rows.map((r) => {
    let parsed: { stdout?: string; sandbox?: SmokeRun["sandbox"] } = {};
    try { parsed = JSON.parse(raw.get(r.runId) ?? "{}"); } catch { /* unreadable raw record */ }
    return {
      runId: r.runId, status: r.status, modelResolved: r.modelResolved, toolVersion: r.toolVersion,
      account: r.account, text: r.text, stdout: parsed.stdout ?? "", sandbox: parsed.sandbox ?? null,
    };
  });
};

const surface = surfacesOf(d, waveId)[0];
const sb = sandboxOf(surface?.config);
if (!surface?.modelRequested || !sb?.digest || !sb.effort || !sb.claudeVersion) {
  console.error(`wave ${waveId} does not pin model, CLI, digest and effort; there is nothing to check against`);
  process.exit(1);
}
const base = load(baseId).filter((r) => r.status !== "error");
const baseModel = surfacesOf(d, baseId)[0]?.modelRequested ?? "";
const findings = smokeFindings(load(waveId), {
  model: surface.modelRequested, claudeVersion: sb.claudeVersion, digest: sb.digest, effort: sb.effort,
}, {
  thinking: base.map((r) => thinkingTokens(r.stdout, baseModel)).filter((x): x is number => x !== null),
  inventory: base.map((r) => initInventory(r.stdout)).find(Boolean) ?? null,
});

const MARK = { pass: "  ok  ", warn: " warn ", fail: " FAIL " } as const;
for (const f of findings) console.log(`[${MARK[f.level]}] ${f.check}\n          ${f.detail}`);
const fails = findings.filter((f) => f.level === "fail").length;
const warns = findings.filter((f) => f.level === "warn").length;
console.log(`\n${fails ? "NOT CLEAR" : warns ? "Clear, after reading the warnings above" : "Clear"} to launch the rest of wave ${waveId}.`);
process.exit(fails ? 1 : 0);
