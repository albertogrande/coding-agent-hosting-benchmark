/**
 * Codex on a Plus subscription, driven headlessly.
 *
 * As with the Claude CLI this is its own surface, never pooled with the OpenAI API one.
 * The output format has not been verified against a real run here, so the parser is
 * defensive and the raw output is stored — confirming the true shape is a re-parse, not
 * a re-run.
 */
import { cliVersion, runCli, sanitiseEnv, throwForOutcome } from "../cli-process";
import { extractCodexCli } from "../extract/codex-cli";
import { CLI_TIMEOUT_MS } from "./chat-cli-claude";
import type { ChatSurface, RunOutcome } from "../types";

export const codexCliChat: ChatSurface = {
  key: "chat.cli.codex",
  label: (cfg) => `Codex (${cfg.model})`,
  price: () => ({ input: 0, output: 0 }),

  async run(prompt, cfg): Promise<RunOutcome> {
    const args = ["exec", ...(cfg.model ? ["--model", cfg.model] : []), prompt];

    const r = await runCli("codex", args, {
      timeoutMs: cfg.timeoutMs ?? CLI_TIMEOUT_MS,
      env: sanitiseEnv(),
    });
    throwForOutcome(r, "codex");

    const e = extractCodexCli(r.stdout, { timedOut: r.timedOut, exitCode: r.exitCode });
    return {
      ...e,
      raw: { stdout: r.stdout, stderr: r.stderr.slice(-4000), exitCode: r.exitCode, timedOut: r.timedOut },
      // The output format is unverified, so nothing here can say which model answered.
      // Unknown is the honest value; echoing the flag back would read as confirmation.
      modelResolved: null,
      toolVersion: await cliVersion("codex"),
      costUsd: 0,
      durationMs: r.durationMs,
    };
  },
};
