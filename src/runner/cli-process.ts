/**
 * Running a coding-agent CLI as a measurement instrument.
 *
 * Ported from `harness/run.py`, whose state machine was worked out against real
 * overnight runs on a Max subscription. Three of its details are not obvious and are the
 * reason this is a port rather than a fresh implementation:
 *
 *  - the child environment must lose far more than the deploy credentials,
 *  - a rate-limited attempt is not a result and must not be stored as one,
 *  - an expired login must stop the wave rather than fail every cell in a second each.
 */
import { spawn } from "node:child_process";
import path from "node:path";

/** Where the fake deploy CLIs live. Prepended to the child's PATH. */
export const SHIMS_DIR = path.join(import.meta.dirname ?? __dirname, "shims");

/**
 * Anything that could let an agent actually deploy, plus — and this is the part that is
 * easy to get wrong — the session variables an Agent SDK host injects.
 *
 * A child that inherits `CLAUDE_CODE_*` / `CLAUDE_AGENT_*` / `ANTHROPIC_*` believes some
 * host process is refreshing its OAuth token, so it never refreshes from the keychain
 * itself and dies in about a second with "OAuth session expired". Stripping them makes
 * the run behave like a plain terminal launch. They are simply unset in a normal shell,
 * so this costs nothing there and saves the whole wave when the app is itself launched
 * from inside an agent session.
 *
 * `ANTHROPIC_API_KEY` going with them is deliberate for a second reason: this surface
 * must run on the subscription at zero marginal cost and can never quietly fall through
 * to metered billing.
 */
export const STRIP_PREFIXES = [
  // Deploy credentials.
  "RAILWAY_", "RENDER_", "FLY_", "VERCEL_", "HEROKU_", "AWS_", "GOOGLE_", "NETLIFY_",
  /**
   * Whole vendor namespaces, not an enumerated list of the variables we happen to know.
   *
   * The harness this is ported from stripped `CLAUDE_CODE_`, `CLAUDE_AGENT_` and
   * `CLAUDE_PREVIEW_`. Probing a live agent session found six more that survived it,
   * including `CLAUDE_SESSION_INGRESS_TOKEN_FILE` — a pointer to a session credential —
   * alongside behaviour overrides like `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` that would
   * quietly change how the measured child behaves. An enumerated list cannot keep up
   * with a namespace, and a leaked host variable is a contaminated measurement whether
   * or not it is a secret.
   *
   * `OPENAI_`/`CODEX_` are here for the same reason `ANTHROPIC_` is: a subscription
   * surface must never fall through to a metered API key.
   */
  "CLAUDE", "ANTHROPIC_", "OPENAI_", "CODEX_",
] as const;

export const STRIP_EXACT = new Set([
  "GH_TOKEN", "GITHUB_TOKEN", "FLY_API_TOKEN", "DIGITALOCEAN_TOKEN",
  // CLAUDECODE and friends are covered by the CLAUDE prefix above; AI_AGENT and BAGGAGE
  // are host-session markers with no shared prefix.
  "AI_AGENT", "BAGGAGE",
]);

/**
 * HOME and PATH stay: the subscription's credentials live under `~/.claude`, and
 * removing PATH would take the CLI itself with it.
 */
export function sanitiseEnv(
  // A plain record in, not NodeJS.ProcessEnv: this reads whatever environment it is
  // handed, and Next's ambient types make NODE_ENV a required key on that interface.
  base: Record<string, string | undefined> = process.env,
  shimsDir: string = SHIMS_DIR,
): NodeJS.ProcessEnv {
  // Built as a plain record and cast on the way out: Next's ambient types make NODE_ENV
  // a required key on ProcessEnv, and this function's whole job is to start from empty.
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) {
    if (STRIP_PREFIXES.some((p) => k.startsWith(p))) continue;
    if (STRIP_EXACT.has(k)) continue;
    env[k] = v;
  }
  env.CI = "1"; // keeps provider CLIs non-interactive
  // Stripping the environment is not enough on its own: the Railway CLI reads
  // ~/.railway/config.json, not the environment, and two runs in the original wave used
  // an already-authenticated CLI to create live billable services — then reported that
  // they picked Railway *because* its CLI was logged in. The harness was measuring
  // laptop auth state. The shims shadow every deploy CLI so a run configures and stops.
  env.PATH = `${shimsDir}${path.delimiter}${base.PATH ?? ""}`;
  return env as NodeJS.ProcessEnv;
}

export const LIMIT_PATTERNS = [
  "usage limit", "rate limit", "limit reached", "429", "too many requests", "quota",
  // "You've hit your session limit · resets 12:40pm" — the Max plan's wording, verbatim.
  "session limit",
];

export const AUTH_PATTERNS = [
  "authentication_failed", "oauth session expired", "invalid api key", "please run /login",
  // A bad or revoked `setup-token` inside the sandbox: the result line says this, exit 1,
  // stderr empty, and `authentication_failed` appears only on the assistant line the
  // verdict does not read.
  "failed to authenticate", "invalid bearer token",
];

/**
 * The CLI refused to be driven at all. Nothing was measured, and nothing will be until a
 * person changes the machine: the first live smoke cell on a container running as root
 * exited in 1.3 s with the first pattern below, and was stored as a *voided* run — which
 * reads as "the answer stopped early", satisfies the cell's debt, and would have let the
 * remaining 125 cells fail identically all night.
 */
export const UNUSABLE_PATTERNS = [
  "cannot be used with root/sudo",
  "--dangerously-skip-permissions cannot be used",
];

/** A rate limit is a "come back later", not a measurement. The cell stays owed. */
export class RateLimitedError extends Error {
  readonly kind = "rate_limited";
}

/** An expired login cannot be fixed without a human, so it stops everything. */
export class AuthFailedError extends Error {
  readonly kind = "auth_failed";
}

/** The harness itself is misconfigured for this machine. Stops the wave; stores nothing. */
export class HarnessError extends Error {
  readonly kind = "harness";
}

export type CliOutcome =
  | "ok" | "timeout" | "rate_limited" | "auth_failed" | "unusable" | "api_error" | "error";

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  outcome: CliOutcome;
};

/**
 * Classifies a finished process.
 *
 * Order matters. An auth failure often also mentions a limit, and treating it as one
 * would sleep for twenty minutes and then fail again identically, eight times.
 */
/**
 * The part of stdout that can carry the CLI's own verdict, as opposed to the agent's prose.
 *
 * A stream-json transcript closes with a `result` line. Everything before it is what the
 * model said and did — and an agent choosing a hosting platform writes "rate limit",
 * "quota" and "429" in the ordinary course of comparing free tiers. The first live pilot
 * cell was classified rate-limited off its own prose after finishing successfully, thrown
 * away, and re-run twenty minutes later. So the limit and auth patterns are read from
 * stderr and from the result line only; a transcript that is not stream-json is read whole,
 * as before, because there is no line to prefer.
 */
function scanForResult(stdout: string): { ev: Record<string, unknown> | null; sawJson: boolean } {
  const lines = stdout.split("\n").filter((l) => l.trim());
  let sawJson = false;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const t = lines[i].trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t) as Record<string, unknown>;
      sawJson = true;
      if (ev.type === "result") return { ev, sawJson };
    } catch {
      /* not a JSON line */
    }
  }
  return { ev: null, sawJson };
}

/** The CLI's own closing verdict, parsed. Null when the transcript carries no result line. */
export function resultEvent(stdout: string): Record<string, unknown> | null {
  return scanForResult(stdout).ev;
}

export function verdictText(stdout: string): string {
  const { ev, sawJson } = scanForResult(stdout);
  if (ev) {
    return [ev.subtype, ev.error, ev.is_error ? ev.result : ""].filter((x) => typeof x === "string").join("\n");
  }
  // Stream-json with no result line (killed mid-run) has nothing to read; plain text is
  // read whole.
  return sawJson ? "" : stdout;
}

export function classify(stdout: string, stderr: string, exitCode: number | null, timedOut: boolean): CliOutcome {
  if (timedOut) return "timeout";
  const blob = `${stderr}\n${verdictText(stdout)}`.toLowerCase();
  if (AUTH_PATTERNS.some((p) => blob.includes(p))) return "auth_failed";
  if (UNUSABLE_PATTERNS.some((p) => blob.includes(p.toLowerCase()))) return "unusable";
  const ev = resultEvent(stdout);
  /**
   * A limit is a failure. A run that exited cleanly with a completed result is a
   * measurement whatever words appear in it — unless the result line itself says it
   * failed. The pilot's third cell came back in six seconds with exit code 0, `is_error:
   * true, api_error_status: 429` and "You've hit your session limit"; the exit-code gate
   * read that as a provider error, and the runner wrote twenty-two error rows in two
   * minutes instead of sleeping until the window opened. A structured verdict that says
   * it failed is believed whatever the exit code; the gate stays for plain text, where the
   * blob is the agent's own prose.
   */
  const saidFailed = ev?.is_error === true;
  // A structured 401 is a login problem whatever the prose says, and a login problem stops
  // the wave: the smoke run with a bad token was read as a provider error, which would have
  // written an error row per cell all night instead of stopping at the first.
  if (saidFailed && ev?.api_error_status === 401) return "auth_failed";
  if (LIMIT_PATTERNS.some((p) => blob.includes(p)) && (exitCode !== 0 || saidFailed)) return "rate_limited";
  if (saidFailed && ev?.api_error_status === 429) return "rate_limited";
  /**
   * A provider error is the instrument failing, not an answer, and it has to be told apart
   * from a run that merely stopped early. The first live cell on this Mac came back in nine
   * seconds with `is_error: true, api_error_status: 500` on its result line; the harness saw
   * only a non-zero exit, stored a voided run, and that satisfied the cell's debt — one
   * transient 500 silently removing a cell from the season with no way to re-run it.
   *
   * Read from the structured verdict, never from the prose: an agent comparing hosting
   * plans writes "API Error" and "500" in the ordinary course of its work. Checked after
   * the limit patterns so a 429 stays a limit, which is waited out rather than recorded.
   */
  if (saidFailed && typeof ev?.api_error_status === "number") return "api_error";
  return exitCode === 0 ? "ok" : "error";
}

const versionCache = new Map<string, Promise<string | null>>();

/**
 * The version of the CLI that will produce the runs, asked once per process.
 *
 * A model is only half of what answered: the CLI's system prompt and tool stack change
 * between releases, and a wave that cannot say which release it ran on cannot be compared
 * with the next one. `null` when the command will not say — recorded as unknown, never
 * guessed from whatever is installed today.
 */
export function cliVersion(cmd: string, env: NodeJS.ProcessEnv = sanitiseEnv()): Promise<string | null> {
  if (!versionCache.has(cmd)) {
    versionCache.set(cmd, runCli(cmd, ["--version"], { timeoutMs: 15_000, env })
      .then((r) => (r.exitCode === 0 ? r.stdout.trim().split("\n")[0]?.trim() || null : null))
      .catch(() => null));
  }
  return versionCache.get(cmd)!;
}

export type RunCliOptions = {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  shimsDir?: string;
  signal?: AbortSignal;
  /** Bytes of output to keep. Transcripts are large; the tail is what classifies. */
  maxOutputBytes?: number;
};

/**
 * Runs a CLI to completion, or kills its whole process group at the timeout.
 *
 * The group matters: an agent CLI spawns children (git, package managers, a language
 * server), and killing only the parent leaves them holding the terminal. The original
 * harness learned this the same way everyone does.
 */
export function runCli(cmd: string, args: string[], opts: RunCliOptions = {}): Promise<CliResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 35 * 60 * 1000;
  const cap = opts.maxOutputBytes ?? 32 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? sanitiseEnv(process.env, opts.shimsDir),
      // Its own process group, so the timeout can take the children with it.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const keep = (buf: string, chunk: string) =>
      (buf + chunk).length > cap ? (buf + chunk).slice(-cap) : buf + chunk;

    child.stdout.on("data", (c) => { stdout = keep(stdout, String(c)); });
    child.stderr.on("data", (c) => { stderr = keep(stderr, String(c)); });

    const killGroup = (sig: NodeJS.Signals) => {
      try { if (child.pid) process.kill(-child.pid, sig); } catch { /* already gone */ }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      // A SIGTERM the agent ignores must not hold the wave open forever.
      setTimeout(() => killGroup("SIGKILL"), 15_000);
    }, timeoutMs);

    const onAbort = () => { killGroup("SIGKILL"); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        stdout, stderr, exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        outcome: classify(stdout, stderr, code, timedOut),
      });
    });
  });
}

/** Turns a classification into the error the queue knows how to act on. */
export function throwForOutcome(r: CliResult, cmd: string): void {
  const tail = (r.stderr || r.stdout).trim().slice(-400);
  if (r.outcome === "auth_failed") {
    throw new AuthFailedError(
      `${cmd} is not logged in. Run \`${cmd}\` in a terminal and sign in, then re-run this wave. ${tail}`,
    );
  }
  if (r.outcome === "rate_limited") {
    throw new RateLimitedError(`${cmd} hit a usage limit. ${tail}`);
  }
  /**
   * Not fatal and not a limit: the provider failed this one call. Raising leaves an error
   * row, which is the one status that does not satisfy a cell's debt, so re-running the
   * wave picks the cell back up instead of the season quietly ending a run short.
   */
  if (r.outcome === "api_error") {
    throw new Error(`${cmd} got a provider error and measured nothing. ${tail}`);
  }
  /**
   * A null exit code is a process that died to a signal, not one that finished. Wave 2's
   * healthchecks × open rep 3 was SIGKILLed 77 seconds in by a process watch on the same
   * machine; the extractor read its partial stream, found no timeout and no non-zero code,
   * and stored an "ok" run with sixteen tool calls and nothing written. Not a measurement:
   * an error row keeps the cell owed, so the resume runs it again.
   */
  if (r.exitCode === null && !r.timedOut) {
    throw new Error(`${cmd} was killed by a signal before it finished and measured nothing. ${tail}`);
  }
  /**
   * A stream-json transcript that never reached its closing result line, from a process that
   * exited non-zero, is the container or the connection dying under the run: Docker Desktop
   * restarting exits the client with 125 or 137 and leaves a half transcript. Stored as voided,
   * it would satisfy the cell's debt with a run that measured nothing. An error row keeps it
   * owed. A run the CLI itself closed, however it ended, still has its result line.
   */
  const { ev, sawJson } = scanForResult(r.stdout);
  if (!r.timedOut && r.exitCode !== 0 && sawJson && !ev) {
    throw new Error(`${cmd} exited ${r.exitCode} before its closing result line and measured nothing. ${tail}`);
  }
  if (r.outcome === "unusable") {
    throw new HarnessError(
      `${cmd} refused to run under this harness on this machine — every cell would fail the same way. ${tail}`,
    );
  }
}
