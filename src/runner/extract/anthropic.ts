/**
 * Turns a raw Anthropic Messages response into the fields the store keeps.
 *
 * Written defensively on purpose. The defect this replaces read citations only off
 * `text` blocks and ignored `web_search_tool_result` entirely, so 149 of 150 runs
 * recorded a search count and no sources at all — and because the raw response was
 * thrown away, it could never be repaired. Here every block type that can carry a URL
 * is walked, unknown shapes are tolerated rather than assumed, and the raw response is
 * stored beside the result.
 */
import type { Extracted, ExtractedSource } from "../types";

type Block = Record<string, unknown>;
const isObj = (v: unknown): v is Block => typeof v === "object" && v !== null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** A stop reason that means the answer stopped early rather than finished. */
export const INCOMPLETE_STOP_REASONS = new Set(["max_tokens", "pause_turn", "refusal"]);

/**
 * Pulls every URL out of one container, whatever it is called. Search results, fetch
 * documents and citations all nest a `url` at some shallow depth, and the field names
 * have moved more than once — matching structure rather than a memorised key list is
 * what keeps this working when they move again.
 */
function urlsIn(node: unknown, kind: ExtractedSource["kind"], out: ExtractedSource[], depth = 0): void {
  if (depth > 4 || !isObj(node)) return;
  const url = str(node.url);
  if (url) {
    out.push({ url, title: str(node.title) ?? str(node.page_title), kind, rank: out.length + 1 });
    return; // one source per object; nested documents are handled by the caller's walk
  }
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((x) => urlsIn(x, kind, out, depth + 1));
    else if (isObj(v)) urlsIn(v, kind, out, depth + 1);
  }
}

export function extractAnthropic(raw: unknown): Extracted {
  const res = isObj(raw) ? raw : {};
  const content = arr(res.content);

  let text = "";
  const citations: ExtractedSource[] = [];
  const searchResults: ExtractedSource[] = [];
  const fetches: ExtractedSource[] = [];
  const searchQueries: string[] = [];
  const toolErrors: string[] = [];

  for (const block of content) {
    if (!isObj(block)) continue;
    const type = str(block.type);

    if (type === "text") {
      text += str(block.text) ?? "";
      // Citations hang off the text they support, and were the only thing the old
      // extractor looked at.
      for (const c of arr(block.citations)) urlsIn(c, "citation", citations);
      continue;
    }

    // What the model asked for: the query itself, which no chat dataset here ever kept.
    if (type === "server_tool_use") {
      const q = isObj(block.input) ? str(block.input.query) : undefined;
      if (q) searchQueries.push(q);
      continue;
    }

    if (type === "web_search_tool_result" || type === "web_fetch_tool_result") {
      const bucket = type === "web_search_tool_result" ? searchResults : fetches;
      const kind = type === "web_search_tool_result" ? "search_result" : "fetch";
      const inner = block.content;
      // A server-tool failure comes back as HTTP 200 with an error *object* where the
      // success case has an *array*. Indexing without checking is how a failed search
      // silently becomes a search that found nothing.
      if (Array.isArray(inner)) {
        for (const item of inner) urlsIn(item, kind, bucket);
      } else if (isObj(inner)) {
        const code = str(inner.error_code);
        if (code) toolErrors.push(`${type}: ${code}`);
        else urlsIn(inner, kind, bucket);
      }
    }
  }

  const usage = isObj(res.usage) ? res.usage : {};
  const serverToolUse = isObj(usage.server_tool_use) ? usage.server_tool_use : {};
  const searchRequests = serverToolUse.web_search_requests;
  const stopReason = str(res.stop_reason) ?? null;

  // Deduplicate within a kind but keep a URL that was both searched and cited: the
  // difference between "it came back in results" and "the answer leaned on it" is the
  // whole retrieval story.
  const seen = new Set<string>();
  const sources = [...citations, ...searchResults, ...fetches].filter((s) => {
    const k = `${s.kind}|${s.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    text,
    stopReason,
    truncated: stopReason !== null && INCOMPLETE_STOP_REASONS.has(stopReason),
    searchCount: typeof searchRequests === "number" ? searchRequests : null,
    searchUnit: typeof searchRequests === "number" ? "anthropic.web_search_requests" : null,
    searchQueries,
    sources,
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    toolErrors,
  };
}
