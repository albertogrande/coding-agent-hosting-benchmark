/**
 * Runs the work a wave still owes.
 *
 * Deliberately boring: pull the pending list, run it, store each result the moment it
 * arrives. Because a stored run is never re-run, invoking this again is the resume —
 * after a crash, a rate-limit window, or a closed laptop.
 */
import type { Db } from "@/db/client";
import {
  pendingRuns, recordRun, recordRunError, setWaveStatus, totalSpentUsd,
  type PendingRun,
} from "@/db/waves";
import { chatSurface, defaultConcurrency } from "./surfaces";
import { runAgent, type AgentKey, type AgentSurfaceConfig } from "./surfaces/agent-repo";
import { AuthFailedError, HarnessError, RateLimitedError } from "./cli-process";
import { environmentStamp } from "./preflight";
import { orderSeedOf, sandboxOf, seededShuffle } from "./sandbox";
import type { EnvStamp } from "@/db/schema";
import { isAgentSurface } from "@/lib/surfaces";
import type { ChatSurface, RunOutcome, SurfaceConfig } from "./types";

/** How long to wait out a subscription window before trying the same cell again. */
export const LIMIT_SLEEP_MS = 20 * 60 * 1000;
/**
 * No cap: a closed window is waited out for as long as it stays closed.
 *
 * Eight attempts was under three hours, and a Max session window is five. Eighteen
 * outlasted a session window but not a weekly one, so a wave that ran out of credits at
 * 1am still stopped at 7am and lost the day until someone re-ran it. A wave is paused by a
 * person (`touch data/PAUSE`, or Ctrl-C), never by the subscription.
 */
export const MAX_LIMITED_ATTEMPTS = Number.POSITIVE_INFINITY;
/**
 * Errors in a row before the wave pauses. Each error row stays owed, so nothing is lost
 * either way, but Docker or the network going down otherwise turns the whole remaining
 * queue into error rows in a couple of minutes and the night with it.
 */
export const MAX_ERROR_STREAK = 3;

export type RunProgress = {
  done: number;
  total: number;
  spentUsd: number;
  last?: { promptKey: string; surfaceLabel: string; status: string };
};

export type RunWaveOptions = {
  /** Omit to let the queue decide from the surfaces owed — see `defaultConcurrency`. */
  concurrency?: number;
  onProgress?: (p: RunProgress) => void;
  /** Stop after this many runs. Used by the pilot button and by tests. */
  limit?: number;
  signal?: AbortSignal;
  /** Swap the adapter lookup. Tests use it; nothing in the app does. */
  resolveSurface?: (key: string) => ChatSurface;
  /** Swap the agent runner. Tests use it; nothing in the app does. */
  runAgent?: (key: AgentKey, repoUrl: string, prompt: string, cfg: AgentSurfaceConfig) => Promise<RunOutcome>;
  /**
   * The account this wave runs on, stamped onto every run it stores. Read from the machine
   * at launch when absent; tests pass one so the suite does not depend on whose laptop it
   * runs on.
   */
  env?: EnvStamp;
  /** Swap the wait between rate-limit retries. Tests use it; nothing in the app does. */
  sleep?: (ms: number) => Promise<void>;
  limitSleepMs?: number;
  maxLimitedAttempts?: number;
  maxErrorStreak?: number;
  /**
   * Asked between runs and while waiting out a limit. A reason stops the wave after the run
   * in flight, which stays stored; nothing in flight is cut short. `run-wave` wires it to the
   * pause file and to the first Ctrl-C.
   */
  pauseRequested?: () => string | null;
};

export type RunWaveResult = {
  attempted: number;
  ok: number;
  voided: number;
  errored: number;
  /** Attempts that hit a usage limit and were waited out. Not stored as runs. */
  rateLimited: number;
  spentUsd: number;
  /** Set when the wave stopped early, with the reason a human needs to read. */
  stoppedBecause?: string;
};

function configOf(p: PendingRun): SurfaceConfig {
  const c = p.config as Partial<SurfaceConfig>;
  return {
    model: p.model,
    maxOutputTokens: typeof c.maxOutputTokens === "number" ? c.maxOutputTokens : undefined,
    searchEnabled: c.searchEnabled !== false,
    maxResumes: typeof c.maxResumes === "number" ? c.maxResumes : undefined,
    timeoutMs: typeof c.timeoutMs === "number" ? c.timeoutMs : undefined,
  };
}

type PlannedTarget = { id?: string; url?: string; sha?: string };

/**
 * The repository a cell runs against, read off the surface's snapshotted target list.
 *
 * A cell names its target by id; the URL and the pinned commit live on the wave surface,
 * where the plan put them. A cell whose target has no URL is an error for that cell —
 * recorded, visible, and still owed — not a reason to stop the wave.
 */
export function targetOf(p: PendingRun): { url: string; sha?: string } {
  const list = Array.isArray(p.config.targets) ? (p.config.targets as PlannedTarget[]) : [];
  const t = list.find((x) => x?.id === p.target);
  if (!t?.url) {
    throw new Error(
      `cell target '${p.target}' has no url on surface ${p.surfaceKey} — ` +
      `declare it under targets[] in the wave design and re-plan`,
    );
  }
  return { url: t.url, ...(t.sha ? { sha: t.sha } : {}) };
}

/**
 * One call, whichever kind of surface the cell belongs to. A chat surface is asked the
 * prompt; an agent surface is handed a repository and the prompt, and reports what it
 * committed to. The two stay separate instruments all the way down — this is only the
 * place they share a queue.
 */
async function runJob(job: PendingRun, opts: RunWaveOptions): Promise<RunOutcome> {
  if (isAgentSurface(job.surfaceKey)) {
    const target = targetOf(job);
    const run = opts.runAgent ?? runAgent;
    const sandbox = sandboxOf(job.config);
    return run(job.surfaceKey as AgentKey, target.url, job.promptText, {
      ...configOf(job), ...target, ...(sandbox ? { sandbox } : {}),
    });
  }
  const surface = (opts.resolveSurface ?? chatSurface)(job.surfaceKey);
  return surface.run(job.promptText, configOf(job));
}

/**
 * An authentication failure is not a result. If the credentials are wrong, every
 * remaining run will fail the same way in milliseconds, so the wave stops instead of
 * burning through its cells and leaving a table full of errors that look like findings.
 *
 * The CLI surfaces raise a typed error for this; the API surfaces surface it as a
 * message, so both are recognised.
 */
export function isFatal(err: unknown, agent = false): string | null {
  if (err instanceof AuthFailedError) return `authentication failed — ${err.message}`;
  // The harness cannot drive the CLI on this machine. Same shape as an expired login:
  // nothing measured, nothing stored, every cell still owed for after someone fixes it.
  if (err instanceof HarnessError) return `harness misconfigured — ${err.message}`;
  // An agent CLI's login failure is already classified from its verdict and arrives as an
  // AuthFailedError. Its other errors carry the transcript's tail, where a request id or a
  // token count can contain "401", and matching that stopped a wave as a failed login.
  if (agent) return null;
  const msg = (err as Error)?.message ?? String(err);
  if (/401|403|authentication|invalid[_ ]api[_ ]key|could not resolve auth/i.test(msg)) {
    return `authentication failed — ${msg}`;
  }
  return null;
}

export async function runWave(db: Db, waveId: number, opts: RunWaveOptions = {}): Promise<RunWaveResult> {

  let queue = pendingRuns(db, waveId);
  // A seed on any surface shuffles the whole queue. See `seededShuffle` for why.
  const seed = queue.map((j) => orderSeedOf(j.config)).find((s) => s !== undefined);
  if (seed !== undefined) queue = seededShuffle(queue, seed);
  if (opts.limit !== undefined) queue = queue.slice(0, opts.limit);

  const total = queue.length;
  const result: RunWaveResult = {
    attempted: 0, ok: 0, voided: 0, errored: 0, rateLimited: 0,
    spentUsd: totalSpentUsd(db, waveId),
  };
  if (!total) return result;

  const { getWave } = await import("@/db/waves");
  const wave = getWave(db, waveId);
  const capUsd = wave?.costCapUsd ?? null;

  // Read once, after the early return, so a wave that owes nothing costs nothing. Every
  // run this call stores carries it: which machine answered, and whether that machine
  // could have tilted the answer.
  const env = opts.env ?? await environmentStamp();

  // Derived here rather than trusted from the caller: a wave that is entirely subscription
  // surfaces has to run one at a time, and a caller that forgets says nothing about it.
  const concurrency = opts.concurrency ?? defaultConcurrency(queue.map((j) => j.surfaceKey));

  setWaveStatus(db, waveId, "running", { startedAt: Math.floor(Date.now() / 1000) });

  let index = 0;
  let stopped: string | undefined;
  let limitedStreak = 0;
  let errorStreak = 0;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limitSleep = opts.limitSleepMs ?? LIMIT_SLEEP_MS;
  const maxLimited = opts.maxLimitedAttempts ?? MAX_LIMITED_ATTEMPTS;
  const maxErrors = opts.maxErrorStreak ?? MAX_ERROR_STREAK;
  const paused = (): boolean => {
    if (stopped) return true;
    if (opts.signal?.aborted) { stopped = "paused by request"; return true; }
    const why = opts.pauseRequested?.();
    if (why) { stopped = why; return true; }
    return false;
  };
  // A limit wait checks for a pause every few seconds rather than sleeping the whole window.
  const waitOut = async (ms: number) => {
    const step = Math.min(ms, 5_000);
    for (let left = ms; left > 0 && !paused(); left -= step) await sleep(Math.min(step, left));
  };

  const worker = async () => {
    for (;;) {
      if (paused()) return;
      const i = index++;
      if (i >= queue.length) return;
      const job = queue[i];

      // Checked before every call, not after the wave: a cap that only reports the
      // overspend afterwards is not a cap.
      if (capUsd !== null && result.spentUsd >= capUsd) {
        stopped = `cost cap reached: $${result.spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}`;
        return;
      }

      result.attempted += 1;
      // One cell may be attempted several times: a subscription window closing is a
      // "come back later", not an answer.
      for (;;) {
        if (paused()) return;
        try {
          const outcome = await runJob(job, opts);
          recordRun(db, job.cellId, job.rep, outcome, { env });
          result.spentUsd += outcome.costUsd ?? 0;
          limitedStreak = 0;
          errorStreak = 0;
          // The run is stored: it is what was served, and the health card reads it. But the
          // wave does not go on serving a model it did not ask for.
          const drift = servedDrift(job, outcome);
          if (drift) stopped = drift;
          if (outcome.truncated) result.voided += 1;
          else result.ok += 1;
          opts.onProgress?.({
            done: result.attempted, total, spentUsd: result.spentUsd,
            last: { promptKey: job.promptKey, surfaceLabel: job.surfaceLabel, status: outcome.truncated ? "voided" : "ok" },
          });
          break;
        } catch (err) {
          /**
           * A usage limit stores nothing. The cell stays owed, the harness waits out the
           * window and asks again — which is what let the original survive closed laptops
           * and exhausted weekly windows without losing a single completed run.
           */
          if (err instanceof RateLimitedError) {
            limitedStreak += 1;
            result.rateLimited += 1;
            if (limitedStreak >= maxLimited) {
              stopped =
                `usage limit window exhausted after ${limitedStreak} attempts — ` +
                `nothing was lost, re-run the wave when the window resets`;
              return;
            }
            const next = new Date(Date.now() + limitSleep);
            opts.onProgress?.({
              done: result.attempted, total, spentUsd: result.spentUsd,
              last: {
                promptKey: job.promptKey, surfaceLabel: job.surfaceLabel,
                status: `usage limit, waiting for the window · next try ${next.toTimeString().slice(0, 5)} · nothing lost`,
              },
            });
            await waitOut(limitSleep);
            continue;
          }

          const fatal = isFatal(err, isAgentSurface(job.surfaceKey));
          // An auth failure measured nothing either, so it leaves no row: the cell stays
          // owed for after someone logs in.
          if (!fatal) {
            recordRunError(db, job.cellId, job.rep, (err as Error).message ?? String(err));
            result.errored += 1;
            errorStreak += 1;
          }
          if (fatal) { stopped = fatal; return; }
          if (errorStreak >= maxErrors) {
            stopped =
              `${errorStreak} errors in a row, the last: ${((err as Error).message ?? String(err)).slice(0, 300)} — ` +
              `every one is still owed; fix the cause and re-run the wave`;
            return;
          }
          opts.onProgress?.({
            done: result.attempted, total, spentUsd: result.spentUsd,
            last: { promptKey: job.promptKey, surfaceLabel: job.surfaceLabel, status: "error" },
          });
          break;
        }
      }
    }
  };

  const workers = Math.max(1, Math.min(concurrency, queue.length));
  await Promise.all(Array.from({ length: workers }, worker));

  const left = pendingRuns(db, waveId).length;
  setWaveStatus(db, waveId, left === 0 ? "complete" : "paused",
    left === 0 ? { finishedAt: Math.floor(Date.now() / 1000) } : {});

  if (stopped) result.stoppedBecause = stopped;
  return result;
}

/**
 * The model an agent run was served, when it is not the one the wave asked for. Agent
 * surfaces only: the Claude transcript names its model on every turn, and a mismatch there
 * is a different instrument. Chat surfaces report dated snapshots of the same model and are
 * read by the health card instead.
 */
export function servedDrift(job: Pick<PendingRun, "surfaceKey" | "model">, outcome: Pick<RunOutcome, "modelResolved">): string | null {
  if (!isAgentSurface(job.surfaceKey) || !job.model || !outcome.modelResolved) return null;
  // A dated snapshot of the same model is the same model. A longer name is not: Opus 5.5's
  // id begins with Opus 5's.
  const served = outcome.modelResolved.replace(/-\d{8}$/, "");
  if (served === job.model) return null;
  return `model drift: asked for ${job.model}, served ${outcome.modelResolved} — the run is stored; ` +
    `the wave stops so a different model does not fill the season`;
}

/** What the remaining work would cost, from the tokens runs have actually used. */
export function estimateRemainingUsd(db: Db, waveId: number, observedAvgUsd?: number): number {
  const pending = pendingRuns(db, waveId).length;
  // Before any run exists there is nothing measured to extrapolate from, so this is
  // openly a guess; after the first few runs it is the wave's own average.
  return pending * (observedAvgUsd ?? 0.02);
}
