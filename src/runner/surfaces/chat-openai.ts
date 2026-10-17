/**
 * ChatGPT models via the Responses API, with web search.
 *
 * The output budget is left unset by default here, which is the deliberate asymmetry: the
 * Responses API does not truncate at a low ceiling of its own, and forcing an artificial
 * cap on one provider and not the other is exactly what made the two engines in the
 * previous dataset incomparable.
 */
import OpenAI from "openai";
import { extractOpenAI } from "../extract/openai";
import type { ChatSurface, RunOutcome } from "../types";

/** List prices, $ per million tokens, for the estimate and the spend cap only. */
const PRICES: [string, { input: number; output: number }][] = [
  ["gpt-5.6", { input: 1.25, output: 10 }],
  ["gpt-5", { input: 1.25, output: 10 }],
  ["gpt-4.1", { input: 2, output: 8 }],
];

export const openaiChat: ChatSurface = {
  key: "chat.api.openai",
  label: (cfg) => `ChatGPT (${cfg.model})`,
  price: (model) => PRICES.find(([p]) => model.startsWith(p))?.[1] ?? { input: 5, output: 25 },

  async run(prompt, cfg): Promise<RunOutcome> {
    const client = new OpenAI({ timeout: cfg.timeoutMs ?? 300_000 });
    const started = Date.now();

    const res = await client.responses.create({
      model: cfg.model,
      input: prompt,
      ...(cfg.searchEnabled === false ? {} : { tools: [{ type: "web_search" }] }),
      ...(cfg.maxOutputTokens ? { max_output_tokens: cfg.maxOutputTokens } : {}),
    });

    const e = extractOpenAI(res);
    const price = openaiChat.price(cfg.model);
    const cost = ((e.inputTokens ?? 0) * price.input + (e.outputTokens ?? 0) * price.output) / 1e6;

    return {
      ...e,
      raw: res,
      modelResolved: (res as { model?: string }).model ?? null,
      costUsd: cost,
      durationMs: Date.now() - started,
    };
  },
};

