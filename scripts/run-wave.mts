/**
 * Runs a wave from the terminal.
 *
 * The subscription surfaces need this rather than the web button: a single agent cell can
 * take half an hour, a wave can span a rate-limit window, and neither fits in an HTTP
 * request. Re-running the same command is the resume — stored runs are never repeated —
 * so an interrupted wave costs nothing but the cell that was in flight.
 *
 *   npx tsx scripts/run-wave.mts <waveId> [--limit N] [--concurrency N] [--surface KEY]
 *   npx tsx scripts/run-wave.mts --wave <waveId> ...   (same thing; the other commands
 *   take --wave, and a tool used at midnight should not ask which form this one wants)
 *
 * Pausing: `touch data/PAUSE`, or Ctrl-C once. The run in flight finishes and is stored,
 * then the wave stops. A second Ctrl-C removes the container and exits at once; that run
 * stays owed. Either way the resume is the same command.
 *
 * Every start runs the preflight with --benchmark --strict first and refuses on any failure
 * or unknown. `--skip-preflight` exists for the test suite and for a person who has just run
 * it by hand.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/db/client";
import { getWave, pendingRuns, surfacesOf } from "../src/db/waves";
import { runWave } from "../src/runner/queue";
import { environmentStamp } from "../src/runner/preflight";
import { defaultConcurrency } from "../src/runner/surfaces";
import { liveContainers, removeContainer, sandboxOf, sandboxStamp, sweepContainers } from "../src/runner/sandbox";
import { listProjects } from "../src/db/repo";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

// Positional or --wave: preflight and status take the flag, and being asked to remember
// which command wants which form is exactly the friction that gets a step skipped.
const waveId = Number(flag("wave") ?? argv[0]);
if (!waveId) {
  console.error("usage: run-wave.mts <waveId | --wave N> [--limit N] [--concurrency N] [--surface KEY]");
  process.exit(2);
}

const d = db();
const wave = getWave(d, waveId);
if (!wave) { console.error(`no wave ${waveId}`); process.exit(1); }

const surfaces = surfacesOf(d, waveId);
const onlySurface = flag("surface");
if (onlySurface && !surfaces.some((s) => s.surfaceKey === onlySurface)) {
  console.error(`wave ${waveId} has no surface '${onlySurface}'. It has: ${surfaces.map((s) => s.surfaceKey).join(", ")}`);
  process.exit(1);
}

const owed = pendingRuns(d, waveId).filter((p) => !onlySurface || p.surfaceKey === onlySurface);
if (!owed.length) { console.log(`wave ${waveId} owes nothing.`); process.exit(0); }

/**
 * One runner per store. Two would draw the same owed runs, and the second insert of a run
 * crashes on the unique index after both have spent the subscription on it.
 */
const dataDir = path.dirname(process.env.AEO_DB ?? path.join(process.cwd(), "data", "aeo.db"));
const lockFile = path.join(dataDir, "run-wave.lock");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
try {
  const held = Number(fs.readFileSync(lockFile, "utf8").split(" ")[0]);
  if (held && held !== process.pid && alive(held)) {
    console.error(`another run-wave is running (pid ${held}, ${lockFile}). Pause it with \`touch ${path.join(dataDir, "PAUSE")}\` first.`);
    process.exit(1);
  }
} catch { /* no lock: nobody is running */ }
fs.writeFileSync(lockFile, `${process.pid} wave ${waveId} ${new Date().toISOString()}\n`);
const releaseLock = () => { try { if (fs.readFileSync(lockFile, "utf8").startsWith(`${process.pid} `)) fs.rmSync(lockFile); } catch { /* gone */ } };
process.on("exit", releaseLock);

// A pause file left from the last stop would stop this start before its first run.
const pauseFile = path.join(dataDir, "PAUSE");
if (fs.existsSync(pauseFile)) { fs.rmSync(pauseFile); console.log(`removed ${pauseFile} left from the last pause`); }

if (!argv.includes("--skip-preflight")) {
  const project = listProjects(d).find((p) => p.id === wave.projectId);
  const pf = spawnSync("npx", ["tsx", "scripts/preflight.mts", project?.slug ?? "", "--wave", String(waveId), "--benchmark", "--strict"], { stdio: "inherit" });
  if (pf.status !== 0) {
    console.error("\npreflight did not clear the wave; nothing was started.");
    process.exit(1);
  }
}

// Containers a killed runner left behind are still spending the subscription on runs nobody
// will store, and would run the same cell twice beside this one.
const swept = await sweepContainers();
if (swept.length) console.log(`removed ${swept.length} container(s) left by an earlier run`);

// The queue derives this from the surfaces owed unless asked otherwise, so the browser's
// Run button and this command cannot disagree about whether a subscription wave may run in
// parallel. `--concurrency` still overrides.
const concurrency = flag("concurrency") ? Number(flag("concurrency")) : defaultConcurrency(owed.map((o) => o.surfaceKey));
const limit = flag("limit") ? Number(flag("limit")) : undefined;

/**
 * Read the account once here rather than inside the queue, so the person who typed the
 * command is told what is about to be stamped on every row before anything runs. A wave
 * on a contaminated account is still allowed — it is how the tool gets developed — it is
 * just no longer able to pass itself off later as a measurement.
 */
const images = [...new Set(owed.map((o) => sandboxOf(o.config)?.image ?? ""))];
const env = images.length === 1 && images[0]
  // Every owed run is sandboxed: the row carries the image, by digest, not this laptop.
  ? await sandboxStamp(images[0])
  : await environmentStamp();

console.log(`wave ${waveId} — ${wave.name}`);
console.log(`${owed.length} runs owed · concurrency ${concurrency}${limit ? ` · stopping after ${limit}` : ""}`);
if (wave.costCapUsd) console.log(`spend cap $${wave.costCapUsd.toFixed(2)}`);
console.log(`account ${env.account} · ${env.clean ? "clean" : `NOT CLEAN: ${env.issues.join(", ")}`}`);
if (!env.clean) {
  console.log(
    "  these runs are stored and gradeable, and `benchmark` will leave them out of a published\n" +
    "  table unless asked for them by name. Run the season from a clean account.",
  );
}
console.log();

let pauseReason: string | null = null;
let interrupts = 0;
const onSignal = async (sig: string) => {
  interrupts += 1;
  if (interrupts === 1) {
    pauseReason = `paused by ${sig}`;
    console.log(`\n${sig}: finishing the run in flight, then stopping. ${sig} again stops now; that run stays owed.`);
    return;
  }
  console.log(`\n${sig} again: removing ${liveContainers.size} container(s) and exiting. The run in flight stays owed.`);
  for (const name of liveContainers) await removeContainer(name);
  releaseLock();
  process.exit(130);
};
process.on("SIGINT", () => void onSignal("SIGINT"));
process.on("SIGTERM", () => void onSignal("SIGTERM"));

const started = Date.now();
const r = await runWave(d, waveId, {
  concurrency,
  limit,
  env,
  pauseRequested: () => {
    if (pauseReason) return pauseReason;
    if (fs.existsSync(pauseFile)) { fs.rmSync(pauseFile); return `paused by ${pauseFile}`; }
    return null;
  },
  onProgress: (p) => {
    const pct = Math.round((100 * p.done) / p.total);
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(
      `  [${String(p.done).padStart(4)}/${p.total} ${String(pct).padStart(3)}%] ${mins}m  ` +
      `$${p.spentUsd.toFixed(2)}  ${p.last?.surfaceLabel ?? ""} ${p.last?.promptKey ?? ""} — ${p.last?.status ?? ""}`,
    );
  },
});

console.log(`\n${r.attempted} attempted · ${r.ok} ok · ${r.voided} voided · ${r.errored} errored` +
  (r.rateLimited ? ` · ${r.rateLimited} waited out a usage limit` : ""));
console.log(`$${r.spentUsd.toFixed(2)} spent`);
if (r.stoppedBecause) {
  console.log(`\nSTOPPED — ${r.stoppedBecause}`);
  console.log(`Re-run the same command to pick up the ${pendingRuns(d, waveId).length} runs still owed.`);
} else if (r.voided) {
  console.log(`\n${r.voided} run(s) did not finish and are voided, not graded. Check the wave health card.`);
}
