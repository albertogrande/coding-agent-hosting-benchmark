/**
 * Claude via the Messages API, with web search.
 *
 * Two things here are direct responses to how the previous instrument failed:
 * the output budget is required rather than defaulted, and a paused server-tool loop is
 * resumed instead of being accepted as a finished answer.
 */
import Anthropic from "@anthropic-ai/sdk";
import { extractAnthropic } from "../extract/anthropic";
import { mergeExtracted } from "../extract/merge";
import type { ChatSurface, Extracted, RunOutcome } from "../types";

/** List prices, $ per million tokens. Used for the estimate and the spend cap only. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
};

/**
 * A wave is a measurement, so the answer must be allowed to finish. The old runbook's
 * 2048 truncated 46% of one engine's scenario answers and produced twelve with no text
 * at all; this floor is set well above the observed median answer length, and a caller
 * may raise it but the code never quietly lowers it.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** Newer models take the filtering search tool; older ones only know the basic one. */
const SEARCH_TOOL_NEW = { type: "web_search_20260209", name: "web_search" } as const;
const SEARCH_TOOL_BASIC = { type: "web_search_20250305", name: "web_search" } as const;

export const anthropicChat: ChatSurface = {
  key: "chat.api.anthropic",
  label: (cfg) => `Claude (${cfg.model})`,
  price: (model) => PRICES[model] ?? { input: 5, output: 25 },

  async run(prompt, cfg): Promise<RunOutcome> {
    const client = new Anthropic({ timeout: cfg.timeoutMs ?? 300_000 });
    const started = Date.now();
    const maxTokens = cfg.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const search = cfg.searchEnabled !== false;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    const raws: unknown[] = [];
    const turns: Extracted[] = [];
    let modelResolved: string | null = null;
    let searchTool: typeof SEARCH_TOOL_NEW | typeof SEARCH_TOOL_BASIC = SEARCH_TOOL_NEW;

    const maxResumes = cfg.maxResumes ?? 3;
    for (let attempt = 0; attempt <= maxResumes; attempt += 1) {
      let res;
      try {
        res = await client.messages.create({
          model: cfg.model,
          max_tokens: maxTokens,
          messages,
          ...(search ? { tools: [searchTool] } : {}),
        });
      } catch (err) {
        // Only the tool-version mismatch is worth a silent retry; anything else is a
        // real failure and must reach the caller rather than becoming a blank run.
        const msg = (err as Error).message ?? "";
        if (search && searchTool === SEARCH_TOOL_NEW && msg.includes(SEARCH_TOOL_NEW.type)) {
          searchTool = SEARCH_TOOL_BASIC;
          attempt -= 1;
          continue;
        }
        throw err;
      }

      raws.push(res);
      turns.push(extractAnthropic(res));
      modelResolved = res.model ?? modelResolved;

      // The server ran its tool loop to its iteration limit. Re-sending the conversation
      // with the assistant turn appended resumes it; no extra user message, the trailing
      // server_tool_use block is the signal.
      if (res.stop_reason === "pause_turn" && attempt < maxResumes) {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      break;
    }

    const merged = mergeExtracted(turns);
    const price = anthropicChat.price(cfg.model);
    const cost =
      ((merged.inputTokens ?? 0) * price.input + (merged.outputTokens ?? 0) * price.output) / 1e6;

    return {
      ...merged,
      raw: raws.length === 1 ? raws[0] : { turns: raws },
      modelResolved,
      costUsd: cost,
      durationMs: Date.now() - started,
    };
  },
};
