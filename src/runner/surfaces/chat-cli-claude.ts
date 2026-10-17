/**
 * Claude Code on a Max subscription, driven headlessly.
 *
 * This is a different instrument from `chat.api.anthropic`, not a cheaper route to it:
 * same weights, different system prompt, different tool stack, different defaults. The
 * schema keeps surfaces apart and the pooling rules refuse to average them; nothing here
 * should make that easier to forget.
 *
 * Zero marginal cost, so `costUsd` is 0 rather than an estimate — but the run is bounded
 * by a subscription window instead, which is why the rate-limit path matters more here
 * than anywhere else in the app.
 */
import { cliVersion, runCli, sanitiseEnv, throwForOutcome } from "../cli-process";
import { extractClaudeCli } from "../extract/claude-cli";
import type { ChatSurface, RunOutcome } from "../types";

/** Adoption is usually decided long before this; a timed-out transcript still parses. */
export const CLI_TIMEOUT_MS = 35 * 60 * 1000;

export const claudeCliChat: ChatSurface = {
  key: "chat.cli.claude",
  label: (cfg) => `Claude Code (${cfg.model})`,
  // Subscription runs are not metered, so there is no price to quote and the wave's
  // spend cap simply never binds on this surface.
  price: () => ({ input: 0, output: 0 }),

  async run(prompt, cfg): Promise<RunOutcome> {
    const args = [
      "-p", prompt,
      "--model", cfg.model,
      "--output-format", "stream-json",
      "--verbose",
    ];

    const r = await runCli("claude", args, {
      timeoutMs: cfg.timeoutMs ?? CLI_TIMEOUT_MS,
      env: sanitiseEnv(),
    });

    // A usage limit or an expired login is not a measurement. Both throw, and the queue
    // decides: sleep and re-offer the cell, or stop the wave.
    throwForOutcome(r, "claude");

    const e = extractClaudeCli(r.stdout, { timedOut: r.timedOut, exitCode: r.exitCode });
    return {
      ...e,
      // The transcript verbatim. Every field above is re-derivable from it.
      raw: { stdout: r.stdout, stderr: r.stderr.slice(-4000), exitCode: r.exitCode, timedOut: r.timedOut },
      // What the transcript says answered — not the flag that was passed. The two used to
      // be the same field, which made a served-model check impossible by construction.
      modelResolved: e.model,
      toolVersion: await cliVersion("claude"),
      costUsd: 0,
      durationMs: r.durationMs,
    };
  },
};
