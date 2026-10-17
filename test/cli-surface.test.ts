import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  AUTH_PATTERNS, LIMIT_PATTERNS, classify, runCli, sanitiseEnv, throwForOutcome, verdictText,
  AuthFailedError, HarnessError, RateLimitedError,
} from "@/runner/cli-process";
import { extractClaudeCli, parseStreamJson } from "@/runner/extract/claude-cli";
import { extractCodexCli } from "@/runner/extract/codex-cli";

describe("sanitiseEnv", () => {
  it("strips every credential that could let a run deploy for real", () => {
    const env = sanitiseEnv({
      PATH: "/usr/bin", HOME: "/home/me",
      RAILWAY_TOKEN: "x", RENDER_API_KEY: "x", FLY_API_TOKEN: "x", VERCEL_TOKEN: "x",
      HEROKU_API_KEY: "x", AWS_SECRET_ACCESS_KEY: "x", GOOGLE_APPLICATION_CREDENTIALS: "x",
      NETLIFY_AUTH_TOKEN: "x", GH_TOKEN: "x", GITHUB_TOKEN: "x", DIGITALOCEAN_TOKEN: "x",
    });
    for (const k of Object.keys(env)) {
      expect(k).not.toMatch(/^(RAILWAY|RENDER|FLY|VERCEL|HEROKU|AWS|GOOGLE|NETLIFY)_/);
    }
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.DIGITALOCEAN_TOKEN).toBeUndefined();
  });

  /**
   * The subtle one, and the reason this is a port rather than a rewrite. A child that
   * inherits an Agent SDK host's session variables believes something else refreshes its
   * OAuth token, never refreshes from the keychain, and dies in about a second. Running
   * this app from inside an agent session is exactly when that bites.
   */
  it("strips the session variables that break the child's own login", () => {
    const env = sanitiseEnv({
      PATH: "/usr/bin",
      CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_AGENT_ID: "a", CLAUDE_PREVIEW_X: "1",
      CLAUDECODE: "1", CLAUDE_PID: "42", CLAUDE_EFFORT: "high", AI_AGENT: "1", BAGGAGE: "x",
    });
    expect(Object.keys(env).filter((k) => k.startsWith("CLAUDE"))).toEqual([]);
    expect(env.AI_AGENT).toBeUndefined();
    expect(env.BAGGAGE).toBeUndefined();
  });

  // A subscription surface must run at zero marginal cost and can never quietly fall
  // through to metered billing — on either vendor.
  it("strips the API keys so a subscription run cannot become a paid one", () => {
    const env = sanitiseEnv({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_BASE_URL: "y",
      OPENAI_API_KEY: "sk-x", OPENAI_BASE_URL: "y", CODEX_HOME: "/z",
    });
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME"]) {
      expect(env[k]).toBeUndefined();
    }
  });

  /**
   * The test that actually catches a leak.
   *
   * A fixture can only assert the variables someone thought to write down, and that is
   * precisely how the ported harness's enumerated `CLAUDE_CODE_` / `CLAUDE_AGENT_` /
   * `CLAUDE_PREVIEW_` list missed six more in a live session — one of them
   * `CLAUDE_SESSION_INGRESS_TOKEN_FILE`. Running against the real environment is the
   * only way to notice a variable nobody knew about.
   */
  it("leaves no vendor-namespaced variable from the real environment", () => {
    const leaked = Object.keys(sanitiseEnv()).filter((k) => /^(CLAUDE|ANTHROPIC_|OPENAI_|CODEX_)/.test(k));
    expect(leaked).toEqual([]);
  });

  it("keeps HOME and PATH, because the login and the CLI itself live there", () => {
    const env = sanitiseEnv({ PATH: "/usr/bin", HOME: "/home/me", LANG: "en_US.UTF-8" });
    expect(env.HOME).toBe("/home/me");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.PATH).toContain("/usr/bin");
  });

  /**
   * Env stripping alone was not enough in the original: the Railway CLI reads
   * ~/.railway/config.json, and two runs used an already-authenticated CLI to create
   * live billable services — then said they picked Railway *because* it was logged in.
   */
  it("puts the deploy-CLI shims ahead of everything on PATH", () => {
    const env = sanitiseEnv({ PATH: "/usr/bin" }, "/shims");
    expect(env.PATH).toBe(`/shims${path.delimiter}/usr/bin`);
    expect(env.CI).toBe("1");
  });
});

describe("shims", () => {
  it("shadows every deploy CLI, and refuses to run", async () => {
    const shims = path.join(process.cwd(), "src", "runner", "shims");
    for (const cli of ["railway", "fly", "flyctl", "vercel", "heroku", "gcloud", "netlify", "aws"]) {
      const r = await runCli(cli, [], { env: sanitiseEnv({ PATH: "/usr/bin" }, shims), timeoutMs: 10_000 });
      expect(r.exitCode).not.toBe(0);
      expect(`${r.stderr}${r.stdout}`).toMatch(/not available in this harness/);
    }
  });
});

describe("classify", () => {
  it("recognises every usage-limit phrasing the original collected", () => {
    for (const p of LIMIT_PATTERNS) {
      expect(classify("", `error: ${p} — try later`, 1, false)).toBe("rate_limited");
    }
  });

  /**
   * Order matters: an expired login often also mentions a limit, and treating it as one
   * would sleep twenty minutes and fail identically, eight times over.
   */
  it("puts an auth failure ahead of a limit when both are mentioned", () => {
    for (const p of AUTH_PATTERNS) {
      expect(classify("", `${p} (rate limit)`, 1, false)).toBe("auth_failed");
    }
  });

  it("calls a timeout a timeout regardless of what was printed", () => {
    expect(classify("", "usage limit", null, true)).toBe("timeout");
  });

  it("distinguishes a clean exit from a failure", () => {
    expect(classify("done", "", 0, false)).toBe("ok");
    expect(classify("", "segfault", 139, false)).toBe("error");
  });

  it("raises the typed errors the queue acts on", () => {
    const base = { stdout: "", stderr: "usage limit", exitCode: 1, timedOut: false, durationMs: 1 };
    expect(() => throwForOutcome({ ...base, outcome: "rate_limited" }, "claude")).toThrow(RateLimitedError);
    expect(() => throwForOutcome({ ...base, outcome: "auth_failed" }, "claude")).toThrow(AuthFailedError);
    expect(() => throwForOutcome({ ...base, outcome: "auth_failed" }, "claude")).toThrow(/not logged in/);
    expect(() => throwForOutcome({ ...base, outcome: "ok" }, "claude")).not.toThrow();
  });

  // Wave 2, healthchecks × open rep 3: SIGKILLed 77 s in by a process watch on the same
  // machine, and stored as "ok" because a null exit code passed every gate. A signal death
  // is an error row — the cell stays owed — and never a timeout, which is the agent's.
  it("treats a signal death as an error that keeps the cell owed", () => {
    const base = { stdout: "", stderr: "", exitCode: null, durationMs: 77_360 };
    expect(() => throwForOutcome({ ...base, timedOut: false, outcome: "error" }, "claude")).toThrow(/killed by a signal/);
    expect(() => throwForOutcome({ ...base, timedOut: true, outcome: "timeout" }, "claude")).not.toThrow();
  });
});

describe("runCli", () => {
  it("captures output and the exit code", async () => {
    const r = await runCli("sh", ["-c", "echo out; echo err >&2; exit 3"], { timeoutMs: 10_000 });
    expect(r.stdout.trim()).toBe("out");
    expect(r.stderr.trim()).toBe("err");
    expect(r.exitCode).toBe(3);
    expect(r.outcome).toBe("error");
  });

  /**
   * The process group is the point: an agent CLI spawns git, package managers and
   * language servers, and killing only the parent leaves them running.
   */
  it("kills the whole process group at the timeout", async () => {
    const r = await runCli("sh", ["-c", "sleep 30 & sleep 30"], { timeoutMs: 700 });
    expect(r.timedOut).toBe(true);
    expect(r.outcome).toBe("timeout");
    expect(r.durationMs).toBeLessThan(10_000);
  }, 20_000);

  it("reports a missing binary as an error rather than hanging", async () => {
    await expect(runCli("definitely-not-a-real-binary-xyz", [], { timeoutMs: 5_000 })).rejects.toThrow();
  });
});

describe("extractClaudeCli", () => {
  // The shape harness/parse.py read for a real overnight wave.
  const jsonl = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Looking at the options." }] } }),
    JSON.stringify({ type: "assistant", message: { content: [
      { type: "tool_use", name: "WebSearch", input: { query: "best place to deploy django" } },
    ] } }),
    JSON.stringify({ type: "assistant", message: { content: [
      { type: "tool_use", name: "WebFetch", input: { url: "https://render.com/docs" } },
      { type: "tool_use", name: "Read", input: { file_path: "/tmp/x" } },
    ] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "I'd go with Render." }] } }),
    JSON.stringify({ type: "result", subtype: "success", num_turns: 7, usage: {
      input_tokens: 1200, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 800, output_tokens: 900,
    } }),
  ].join("\n");

  it("reads text, searches, fetches and usage out of the stream", () => {
    const t = parseStreamJson(jsonl);
    expect(t.text).toBe("Looking at the options.\nI'd go with Render.");
    expect(t.searchQueries).toEqual(["best place to deploy django"]);
    expect(t.fetchedUrls).toEqual(["https://render.com/docs"]);
    expect(t.toolCalls).toBe(3);
    expect(t.turns).toBe(7);
    // Cache reads and writes are still input the model saw.
    expect(t.inputTokens).toBe(42_000);
    expect(t.outputTokens).toBe(900);
  });

  it("records a fetched page as a fetch, not a search result", () => {
    const e = extractClaudeCli(jsonl, { timedOut: false, exitCode: 0 });
    expect(e.sources).toEqual([{ url: "https://render.com/docs", kind: "fetch", rank: 1 }]);
    expect(e.searchUnit).toBe("claude-cli.websearch_calls");
    expect(e.truncated).toBe(false);
  });

  // The CLI has no token ceiling to hit, but invariant 1 is unchanged: a run that did
  // not finish is voided rather than graded.
  it("voids a timed-out or failed run", () => {
    expect(extractClaudeCli(jsonl, { timedOut: true, exitCode: null }).truncated).toBe(true);
    expect(extractClaudeCli(jsonl, { timedOut: true, exitCode: null }).stopReason).toBe("timeout");
    expect(extractClaudeCli(jsonl, { timedOut: false, exitCode: 1 }).truncated).toBe(true);
    // Killed by a signal, no timeout: the stream is partial whatever the result line says.
    expect(extractClaudeCli(jsonl, { timedOut: false, exitCode: null }).truncated).toBe(true);
    expect(extractClaudeCli(jsonl, { timedOut: false, exitCode: null }).stopReason).toBe("killed");
  });

  /**
   * The format may have moved since it was documented. A line that will not parse is
   * counted and surfaced rather than silently dropped, because a silent drop is how an
   * adapter fault becomes a finding about the brand.
   */
  it("counts unparseable lines instead of swallowing them", () => {
    const e = extractClaudeCli(`${jsonl}\nnot json at all\n{"broken":`, { timedOut: false, exitCode: 0 });
    expect(e.unparsedLines).toBe(2);
    expect(e.toolErrors[0]).toMatch(/2 transcript line\(s\) did not parse/);
  });

  it("survives an empty or junk transcript", () => {
    for (const junk of ["", "\n\n", "hello"]) {
      expect(() => extractClaudeCli(junk, { timedOut: false, exitCode: 0 })).not.toThrow();
    }
    expect(extractClaudeCli("", { timedOut: false, exitCode: 0 }).text).toBe("");
  });
});

describe("extractCodexCli", () => {
  it("reads a structured stream when it gets one", () => {
    const raw = [
      JSON.stringify({ type: "message", text: "Comparing the options." }),
      JSON.stringify({ type: "tool", input: { query: "render vs fly pricing" } }),
      JSON.stringify({ type: "tool", input: { url: "https://fly.io/docs" } }),
    ].join("\n");
    const e = extractCodexCli(raw, { timedOut: false, exitCode: 0 });
    expect(e.structured).toBe(true);
    expect(e.searchCount).toBe(1);
    expect(e.searchUnit).toBe("codex-cli.search_calls");
    expect(e.sources.map((s) => s.url)).toEqual(["https://fly.io/docs"]);
    expect(e.toolErrors).toEqual([]);
  });

  /**
   * The format is unverified, so an unstructured run reports its search count as
   * *unknown* rather than zero. A confident zero is how "the agent never searched"
   * becomes a finding it has not earned — the same mistake the original agent arm made
   * with a citations column that was never populated.
   */
  it("reports an unknown search count rather than zero on plain output", () => {
    const e = extractCodexCli("I compared them and picked https://render.com/docs.", { timedOut: false, exitCode: 0 });
    expect(e.structured).toBe(false);
    expect(e.searchCount).toBeNull();
    expect(e.searchUnit).toBeNull();
    expect(e.toolErrors[0]).toMatch(/unknown for this run, not zero/);
    // Trailing punctuation is not part of the URL.
    expect(e.sources.map((s) => s.url)).toEqual(["https://render.com/docs"]);
  });

  it("voids a timed-out run", () => {
    expect(extractCodexCli("partial", { timedOut: true, exitCode: null }).truncated).toBe(true);
  });
});

describe("the transcript records how the agent decided, not just how much", () => {
  /**
   * Counts say the agent searched three times. The sequence says it searched, read a
   * competitor's page, and only then wrote the config — which is the evidence behind an
   * adoption verdict rather than a summary of one, and the thing a transcript is kept for.
   */
  it("keeps every tool call in order, with what identifies it", () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { content: [
        { type: "tool_use", id: "t1", name: "WebSearch", input: { query: "go api hosting" } },
      ] } }),
      JSON.stringify({ type: "assistant", message: { content: [
        { type: "tool_use", id: "t2", name: "WebFetch", input: { url: "https://render.com/docs" } },
      ] } }),
      JSON.stringify({ type: "assistant", message: { content: [
        { type: "tool_use", id: "t3", name: "Write", input: { file_path: "render.yaml" } },
      ] } }),
    ].join("\n");

    const t = parseStreamJson(jsonl);
    expect(t.toolTimeline).toEqual([
      { seq: 1, tool: "WebSearch", detail: "go api hosting" },
      { seq: 2, tool: "WebFetch", detail: "https://render.com/docs" },
      { seq: 3, tool: "Write", detail: "render.yaml" },
    ]);
  });

  /**
   * A failed tool call still returns prose to the model, so the run reads as healthy from
   * outside. Without this, "the search found nothing about the brand" and "the search never
   * happened" are the same row — and only one of those is a finding.
   */
  it("records a failed tool call against the tool that failed", () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { content: [
        { type: "tool_use", id: "t1", name: "WebSearch", input: { query: "deploy" } },
      ] } }),
      JSON.stringify({ type: "user", message: { content: [
        { type: "tool_result", tool_use_id: "t1", is_error: true, content: "upstream timeout" },
      ] } }),
    ].join("\n");

    expect(parseStreamJson(jsonl).toolErrors).toEqual(["WebSearch: upstream timeout"]);
  });

  it("does not treat a successful tool result as a failure", () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { content: [
        { type: "tool_use", id: "t1", name: "WebSearch", input: { query: "deploy" } },
      ] } }),
      JSON.stringify({ type: "user", message: { content: [
        { type: "tool_result", tool_use_id: "t1", content: "3 results" },
      ] } }),
    ].join("\n");

    expect(parseStreamJson(jsonl).toolErrors).toEqual([]);
  });

  /** A transcript line this parser cannot read is the adapter's fault, and is reported. */
  it("surfaces unreadable transcript lines as a tool error, not silence", () => {
    const e = extractClaudeCli("{not json}\n", { timedOut: false, exitCode: 0 });
    expect(e.toolErrors).toEqual(["1 transcript line(s) did not parse"]);
  });
});

/**
 * The first live smoke cell of the agent surface ran on a container whose user was root.
 * The CLI refused `--dangerously-skip-permissions` in 1.3 s, and the run was stored as
 * *voided* — read as "the answer stopped early", satisfying the cell's debt, with 125 cells
 * queued to fail identically behind it. A harness that cannot drive the CLI has measured
 * nothing, and must say so the way an expired login does: stop, store nothing.
 */
describe("a CLI the harness cannot drive", () => {
  it("is classified as unusable, ahead of the limit patterns", () => {
    const stderr = "--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons";
    expect(classify("", stderr, 1, false)).toBe("unusable");
    // The refusal text is not a rate limit even when a limit word appears nearby.
    expect(classify("", `${stderr}\nquota`, 1, false)).toBe("unusable");
  });

  it("throws the fatal error the queue stops on", () => {
    const base = { stdout: "", stderr: "cannot be used with root/sudo", exitCode: 1, timedOut: false, durationMs: 1 };
    expect(() => throwForOutcome({ ...base, outcome: "unusable" }, "claude")).toThrow(HarnessError);
    expect(() => throwForOutcome({ ...base, outcome: "unusable" }, "claude")).toThrow(/every cell would fail/);
  });
});

describe("the transcript names the model that answered", () => {
  it("reads the served model off the assistant turns, last one winning", () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5", content: [{ type: "text", text: "Hi." }] } }),
      JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5", content: [{ type: "text", text: "Render." }] } }),
      JSON.stringify({ type: "result", subtype: "success", num_turns: 2, usage: { input_tokens: 1, output_tokens: 1 } }),
    ].join("\n");
    expect(parseStreamJson(jsonl).model).toBe("claude-sonnet-5");
    expect(extractClaudeCli(jsonl, { timedOut: false, exitCode: 0 }).model).toBe("claude-sonnet-5");
  });

  /** No turn named a model: unknown, never the flag that was passed. */
  it("reports null rather than echoing the requested model when no turn names one", () => {
    const jsonl = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hi." }] } });
    expect(parseStreamJson(jsonl).model).toBeNull();
  });
});

/**
 * The first live pilot cell finished in 1.2 minutes with a render.yaml in the tree — and
 * was classified rate-limited off its own prose ("no usage-based billing", "free tier"
 * comparisons), thrown away, and re-run after a twenty-minute sleep. An agent choosing a
 * hosting platform says "rate limit", "quota" and "429" in the ordinary course of its work;
 * the CLI's verdict is in the result line and on stderr, not in the transcript.
 */
describe("a limit is read from the CLI's verdict, not the agent's prose", () => {
  const transcript = (result: Record<string, unknown>) => [
    JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5", content: [
      { type: "text", text: "Render's free tier has a request quota and rate limit; Fly returns 429 under load." },
    ] } }),
    JSON.stringify({ type: "result", ...result }),
  ].join("\n");

  it("keeps a completed run whose prose mentions limits", () => {
    const out = transcript({ subtype: "success", is_error: false, result: "Done. Chose Render." });
    expect(classify(out, "", 0, false)).toBe("ok");
  });

  it("still catches a real usage limit reported by the CLI", () => {
    const out = transcript({ subtype: "error_during_execution", is_error: true, result: "You have hit your usage limit. Try again later." });
    expect(classify(out, "", 1, false)).toBe("rate_limited");
    expect(classify("", "Error: rate limit reached for this window", 1, false)).toBe("rate_limited");
  });

  it("never calls a clean exit rate-limited, whatever stderr says", () => {
    expect(classify("plain text answer", "warning: quota nearly reached", 0, false)).toBe("ok");
  });

  it("reads plain text whole when there is no result line", () => {
    expect(classify("usage limit reached", "", 1, false)).toBe("rate_limited");
    expect(verdictText("just prose")).toBe("just prose");
    expect(verdictText(JSON.stringify({ type: "assistant", message: { content: [] } }))).toBe("");
  });
});

/**
 * The first live cell run on the author's Mac came back in nine seconds carrying
 * `is_error: true, api_error_status: 500`. The harness saw a non-zero exit, stored a voided
 * run, and a voided run satisfies its cell's debt — so one transient provider fault removed
 * a cell from the season with no way left to re-run it.
 */
describe("a provider error is not a measurement", () => {
  const transcript = (result: Record<string, unknown>) => [
    JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5", content: [
      { type: "text", text: "Comparing free tiers: Render publishes a quota, Fly answers 429 under load." },
    ] } }),
    JSON.stringify({ type: "result", ...result }),
  ].join("\n");

  const apiError = (status: number) => transcript({
    subtype: "success", is_error: true, api_error_status: status,
    result: `API Error: ${status} Internal server error. This is a server-side issue, usually temporary.`,
  });

  it("classifies an upstream 500 as a provider error, whatever the exit code says", () => {
    expect(classify(apiError(500), "", 1, false)).toBe("api_error");
    expect(classify(apiError(500), "", 0, false)).toBe("api_error");
  });

  it("raises, so the cell keeps its debt instead of storing a voided answer", () => {
    const r = {
      stdout: apiError(503), stderr: "", exitCode: 1, timedOut: false, durationMs: 9401,
      outcome: "api_error" as const,
    };
    expect(() => throwForOutcome(r, "claude")).toThrow(/provider error/i);
    // Not a limit and not an auth failure: waiting out a window or stopping the wave would
    // both be the wrong response to one failed call.
    expect(() => throwForOutcome(r, "claude")).not.toThrow(RateLimitedError);
    expect(() => throwForOutcome(r, "claude")).not.toThrow(AuthFailedError);
  });

  it("still reads a 429 as a usage limit, which is waited out rather than recorded", () => {
    const out = transcript({
      subtype: "error_during_execution", is_error: true, api_error_status: 429,
      result: "API Error: 429 rate limit reached.",
    });
    expect(classify(out, "", 1, false)).toBe("rate_limited");
  });

  /**
   * The pilot's third cell, verbatim: exit code 0, `subtype: "success"`, and a result line
   * saying `is_error: true, api_error_status: 429` with the Max plan's wording. Read as a
   * provider error, the runner wrote an error row for every remaining cell in two minutes
   * instead of waiting for the window; nothing was lost, and nothing was measured either.
   */
  it("reads a closed session window as a limit even when the CLI exits 0", () => {
    const out = transcript({
      subtype: "success", is_error: true, api_error_status: 429, num_turns: 11,
      result: "You've hit your session limit · resets 12:40pm (America/Sao_Paulo)",
    });
    expect(classify(out, "", 0, false)).toBe("rate_limited");
    // The status alone is enough: the wording may change, the code is the contract.
    const bare = transcript({ subtype: "success", is_error: true, api_error_status: 429, result: "" });
    expect(classify(bare, "", 0, false)).toBe("rate_limited");
  });

  it("leaves a clean run alone even when the agent's prose says API Error", () => {
    const out = transcript({ subtype: "success", is_error: false, result: "Chose Render. Note: their API returns 500 on cold start." });
    expect(classify(out, "", 0, false)).toBe("ok");
  });
});

/**
 * What Claude Code 2.1.260 prints inside the sandbox when `CLAUDE_CODE_OAUTH_TOKEN` is bad:
 * a result line with `is_error: true, api_error_status: 401`, exit 1, empty stderr. Read as
 * a provider error this writes an error row per cell all night; it is a login failure and
 * stops the wave.
 */
describe("a bad sandbox token", () => {
  const stdout = [
    JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-5" }),
    JSON.stringify({ type: "system", subtype: "api_retry", error_status: 401, error: "authentication_failed" }),
    JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: 401, result: "Failed to authenticate. API Error: 401 Invalid bearer token", num_turns: 1 }),
  ].join("\n");

  it("is classified as an authentication failure, not a provider error", () => {
    expect(classify(stdout, "", 1, false)).toBe("auth_failed");
    expect(() => throwForOutcome({ stdout, stderr: "", exitCode: 1, timedOut: false, durationMs: 1, outcome: "auth_failed" }, "claude"))
      .toThrow(AuthFailedError);
  });
});
