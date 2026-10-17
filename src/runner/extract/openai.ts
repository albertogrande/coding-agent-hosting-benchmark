/**
 * Turns a raw OpenAI Responses payload into the same fields as the Anthropic extractor.
 *
 * The two providers report the same ideas in different shapes, and the point of
 * normalising here — rather than in a report — is that the differences that matter stay
 * visible. Search counts in particular are not the same unit on both sides, so the unit
 * travels with the number instead of being assumed away.
 */
import type { Extracted, ExtractedSource } from "../types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function collectUrls(node: unknown, kind: ExtractedSource["kind"], out: ExtractedSource[], depth = 0): void {
  if (depth > 4 || !isObj(node)) return;
  const url = str(node.url);
  if (url) {
    out.push({ url, title: str(node.title), kind, rank: out.length + 1 });
    return;
  }
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((x) => collectUrls(x, kind, out, depth + 1));
    else if (isObj(v)) collectUrls(v, kind, out, depth + 1);
  }
}

export function extractOpenAI(raw: unknown): Extracted {
  const res = isObj(raw) ? raw : {};
  const output = arr(res.output);

  let text = str(res.output_text) ?? "";
  const citations: ExtractedSource[] = [];
  const searchResults: ExtractedSource[] = [];
  const searchQueries: string[] = [];
  const toolErrors: string[] = [];
  let searchCalls = 0;

  for (const item of output) {
    if (!isObj(item)) continue;
    const type = str(item.type);

    if (type === "web_search_call") {
      searchCalls += 1;
      const action = isObj(item.action) ? item.action : {};
      const q = str(action.query);
      if (q) searchQueries.push(q);
      // Some responses carry the result set on the call; when they do it is a genuine
      // search-result list, distinct from what the answer went on to cite.
      collectUrls(action, "search_result", searchResults);
      const status = str(item.status);
      if (status && status !== "completed") toolErrors.push(`web_search_call: ${status}`);
      continue;
    }

    if (type === "message") {
      for (const part of arr(item.content)) {
        if (!isObj(part)) continue;
        // output_text is the aggregate; fall back to per-part text if it was absent.
        if (!res.output_text) text += str(part.text) ?? "";
        for (const a of arr(part.annotations)) {
          if (isObj(a) && str(a.type) === "url_citation") collectUrls(a, "citation", citations);
        }
      }
    }
  }

  const usage = isObj(res.usage) ? res.usage : {};
  const incomplete = isObj(res.incomplete_details) ? res.incomplete_details : {};
  const status = str(res.status) ?? null;
  const reason = str(incomplete.reason);
  // Two different facts, kept together: `status` says the response is incomplete, and
  // `reason` says why. Only the ceiling case means the text stops mid-thought.
  const stopReason = reason ? `${status ?? "incomplete"}:${reason}` : status;

  const seen = new Set<string>();
  const sources = [...citations, ...searchResults].filter((s) => {
    const k = `${s.kind}|${s.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    text,
    stopReason,
    truncated: status === "incomplete",
    searchCount: searchCalls,
    searchUnit: "openai.web_search_calls",
    searchQueries,
    sources,
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    toolErrors,
  };
}
