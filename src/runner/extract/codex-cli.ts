/**
 * Parses `codex exec` output.
 *
 * Unlike the Claude CLI, this format has not been verified against a real run here, so
 * the parser is written to work from whatever arrives: it tries JSONL first, and falls
 * back to reading plain text and lifting URLs and search lines out of it. The raw output
 * is stored either way, so confirming the real shape later is a re-parse.
 *
 * Everything it reports is therefore best-effort except the text, and a run whose
 * structure could not be read says so in `toolErrors` rather than reporting a confident
 * zero — the difference between "no searches" and "we could not tell" is exactly the
 * distinction the rest of this app exists to preserve.
 */
import type { Extracted, ExtractedSource } from "../types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** Strips trailing punctuation a URL picked up from prose. */
const tidy = (u: string) => u.replace(/[.,;:!?]+$/, "");

export function extractCodexCli(
  raw: string,
  meta: { timedOut: boolean; exitCode: number | null },
): Extracted & { structured: boolean } {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  let text = "";
  const searchQueries: string[] = [];
  const urls: string[] = [];
  let structured = false;
  let jsonLines = 0;

  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    let ev: unknown;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!isObj(ev)) continue;
    jsonLines += 1;

    // Best-effort across plausible shapes: a message with text, a tool call with a query
    // or a URL. Anything unrecognised is left alone rather than guessed at.
    const t = str(ev.text) ?? str((isObj(ev.message) ? ev.message.content : undefined) as unknown);
    if (t) text += `${t}\n`;
    const q = str(ev.query) ?? (isObj(ev.input) ? str(ev.input.query) : undefined);
    if (q) searchQueries.push(q);
    const u = str(ev.url) ?? (isObj(ev.input) ? str(ev.input.url) : undefined);
    if (u) urls.push(u);
  }

  if (jsonLines > 0 && (text || searchQueries.length || urls.length)) {
    structured = true;
  } else {
    // Plain text. Keep the whole output as the answer and lift URLs out of it, but do
    // not pretend to know how many searches ran.
    text = raw.trim();
    for (const m of raw.matchAll(URL_RE)) urls.push(tidy(m[0]));
  }

  const sources: ExtractedSource[] = [...new Set(urls)].map((url, i) => ({
    url, kind: "fetch" as const, rank: i + 1,
  }));

  const incomplete = meta.timedOut || (meta.exitCode !== null && meta.exitCode !== 0);
  const toolErrors: string[] = [];
  if (!structured) {
    toolErrors.push(
      "codex output was not structured — search counts are unknown for this run, not zero",
    );
  }

  return {
    text,
    stopReason: meta.timedOut ? "timeout" : meta.exitCode === 0 ? "end_turn" : `exit_${meta.exitCode}`,
    truncated: incomplete,
    // Unknown rather than zero when the structure could not be read. A confident zero
    // here is how "the agent never searched" becomes a finding it has not earned.
    searchCount: structured ? searchQueries.length : null,
    searchUnit: structured ? "codex-cli.search_calls" : null,
    searchQueries,
    sources,
    inputTokens: null,
    outputTokens: null,
    toolErrors,
    structured,
  };
}
