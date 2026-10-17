import { anthropicChat } from "./chat-anthropic";
import { openaiChat } from "./chat-openai";
import { claudeCliChat } from "./chat-cli-claude";
import { codexCliChat } from "./chat-cli-codex";
import type { ChatSurface } from "../types";

/**
 * Every chat surface the runner can drive, by the key stored on `wave_surfaces`.
 *
 * The API and CLI surfaces for the same vendor are separate entries on purpose. Claude
 * Code on a subscription is not the consumer Claude app — same weights, different system
 * prompt, different tool stack — and the one thing this app must never make easy is
 * averaging two instruments into one number.
 */
export const CHAT_SURFACES: Record<string, ChatSurface> = {
  [anthropicChat.key]: anthropicChat,
  [openaiChat.key]: openaiChat,
  [claudeCliChat.key]: claudeCliChat,
  [codexCliChat.key]: codexCliChat,
};

/**
 * True when a surface runs on a subscription and costs nothing per run.
 *
 * The agent surfaces are here too: they drive the same CLIs on the same subscriptions,
 * and the runner reads this set to run them one at a time — the windows are per-account,
 * so parallelism buys nothing and makes a closed window harder to read.
 */
export const SUBSCRIPTION_SURFACES = new Set([
  claudeCliChat.key, codexCliChat.key, "agent.repo.claude", "agent.repo.codex",
]);

/**
 * How many cells to run at once, given the surfaces a wave still owes.
 *
 * One at a time on a subscription: the usage windows are per-account, so parallelism buys
 * nothing there and makes a closed window harder to read. This lived in `run-wave.mts`,
 * which meant the browser's Run button — the other caller — ran four agent cells at once
 * against the same Max account, and the reason it should not was written down in a place it
 * never read. The default belongs where the surface registry is.
 */
export function defaultConcurrency(surfaceKeys: Iterable<string>): number {
  const keys = [...new Set(surfaceKeys)];
  if (!keys.length) return 1;
  return keys.every((k) => SUBSCRIPTION_SURFACES.has(k)) ? 1 : 4;
}

export function chatSurface(key: string): ChatSurface {
  const s = CHAT_SURFACES[key];
  if (!s) throw new Error(`unknown surface '${key}' — known: ${Object.keys(CHAT_SURFACES).join(", ")}`);
  return s;
}
