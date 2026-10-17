/**
 * Parses a `claude -p --output-format stream-json` transcript.
 *
 * The format is JSONL: one JSON object per line. Assistant turns arrive as
 * `{type:"assistant", message:{content:[…]}}` carrying `text` and `tool_use` blocks, and
 * the run closes with `{type:"result"}` carrying usage and a turn count. That shape is
 * documented by the harness that read it for a real overnight wave
 * (`harness/parse.py:read_transcript`).
 *
 * Written to tolerate the format having moved since: unknown line types are ignored, a
 * malformed line is skipped rather than fatal, and the raw JSONL is stored alongside the
 * result. If a field has been renamed, this is a re-parse rather than a re-run.
 */
import type { Extracted, ExtractedSource } from "../types";
import type { ToolEvent } from "@/db/schema";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export type ClaudeCliTranscript = {
  text: string;
  searchQueries: string[];
  fetchedUrls: string[];
  toolCalls: number;
  turns: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Present on the closing result line when the CLI reports one. */
  resultSubtype: string | null;
  /**
   * The model the assistant turns say they came from — what was *served*, as opposed to
   * what `--model` asked for. Null when no assistant turn carried one.
   */
  model: string | null;
  /** Lines that would not parse. A non-zero count is a format change, not noise. */
  unparsedLines: number;
  /**
   * Every tool call in order. Counts say how much the agent did; the sequence says how it
   * decided — searched, read this page, then wrote that file — which is the difference
   * between an adoption verdict you can defend and one you have to trust.
   */
  toolTimeline: ToolEvent[];
  /** Tool calls the transcript reports as failed. Not a measurement of anything else. */
  toolErrors: string[];
};

export function parseStreamJson(jsonl: string): ClaudeCliTranscript {
  let text = "";
  const searchQueries: string[] = [];
  const fetchedUrls: string[] = [];
  let toolCalls = 0;
  let turns: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let resultSubtype: string | null = null;
  let model: string | null = null;
  let unparsedLines = 0;
  const toolTimeline: ToolEvent[] = [];
  const toolErrors: string[] = [];
  // Tool results arrive on later lines than the call, so remember which id was which tool.
  const toolById = new Map<string, string>();

  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(t);
    } catch {
      unparsedLines += 1;
      continue;
    }
    if (!isObj(ev)) continue;

    if (str(ev.type) === "assistant") {
      const msg = isObj(ev.message) ? ev.message : {};
      // Every assistant turn names its model; the last one wins, and a run whose turns
      // disagree with each other is a run worth a look, so the first is not preferred.
      model = str(msg.model) ?? model;
      for (const blk of arr(msg.content)) {
        if (!isObj(blk)) continue;
        const bt = str(blk.type);
        if (bt === "text") text += `${str(blk.text) ?? ""}\n`;
        else if (bt === "tool_use") {
          toolCalls += 1;
          const name = str(blk.name);
          const input = isObj(blk.input) ? blk.input : {};
          const id = str(blk.id);
          if (name && id) toolById.set(id, name);
          // The detail is whatever identifies this call to a reader: what was searched for,
          // which page was opened, which file was touched.
          const detail =
            str(input.query) ?? str(input.url) ?? str(input.file_path) ?? str(input.path) ?? str(input.command);
          if (name) toolTimeline.push({ seq: toolTimeline.length + 1, tool: name, ...(detail ? { detail } : {}) });
          if (name === "WebSearch") {
            const q = str(input.query);
            if (q) searchQueries.push(q);
          } else if (name === "WebFetch") {
            const u = str(input.url);
            if (u) fetchedUrls.push(u);
          }
        }
      }
      continue;
    }

    // A failed tool call still returns prose to the model, so the run looks fine from the
    // outside. Recording the failure is the only way a later reader can tell the difference
    // between "the search found nothing" and "the search did not happen".
    if (str(ev.type) === "user") {
      const msg = isObj(ev.message) ? ev.message : {};
      for (const blk of arr(msg.content)) {
        if (!isObj(blk) || str(blk.type) !== "tool_result") continue;
        if (blk.is_error !== true) continue;
        const id = str(blk.tool_use_id);
        const name = (id && toolById.get(id)) || "tool";
        const body = typeof blk.content === "string"
          ? blk.content
          : arr(blk.content).map((c) => (isObj(c) ? str(c.text) ?? "" : "")).join(" ");
        toolErrors.push(`${name}: ${body.trim().slice(0, 300)}`);
      }
      continue;
    }

    if (str(ev.type) === "result") {
      resultSubtype = str(ev.subtype) ?? null;
      turns = num(ev.num_turns);
      const usage = isObj(ev.usage) ? ev.usage : {};
      // Cache reads and writes are still input the model saw, so they belong in the total.
      const cached = (num(usage.cache_read_input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0);
      const base = num(usage.input_tokens);
      inputTokens = base === null && cached === 0 ? null : (base ?? 0) + cached;
      outputTokens = num(usage.output_tokens);
    }
  }

  return {
    text: text.trimEnd(),
    searchQueries, fetchedUrls, toolCalls, turns,
    inputTokens, outputTokens, resultSubtype, model, unparsedLines,
    toolTimeline, toolErrors,
  };
}

/**
 * Maps a transcript onto the store's shape.
 *
 * `truncated` here means a timeout or a non-zero exit, not a token ceiling — the CLI has
 * no `max_tokens` to hit. The rule it feeds is unchanged: a run that did not finish is
 * voided rather than graded.
 */
export function extractClaudeCli(
  jsonl: string,
  meta: { timedOut: boolean; exitCode: number | null },
): Extracted & { turns: number | null; unparsedLines: number; model: string | null } {
  const t = parseStreamJson(jsonl);

  // A fetched URL is a page pulled into context, which is a stronger claim than a search
  // result and is kept distinct from one.
  const sources: ExtractedSource[] = [...new Set(t.fetchedUrls)].map((url, i) => ({
    url, kind: "fetch" as const, rank: i + 1,
  }));

  // A null exit code is a signal death, which is as incomplete as a non-zero one.
  const incomplete = meta.timedOut || meta.exitCode !== 0;
  return {
    text: t.text,
    stopReason: meta.timedOut ? "timeout"
      : meta.exitCode === null ? "killed"
      : (t.resultSubtype ?? (meta.exitCode === 0 ? "end_turn" : `exit_${meta.exitCode}`)),
    truncated: incomplete,
    searchCount: t.searchQueries.length,
    // Named for what it counts: WebSearch tool invocations by this CLI, which is not the
    // same quantity as either provider API's search count.
    searchUnit: "claude-cli.websearch_calls",
    searchQueries: t.searchQueries,
    sources,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    // Two different faults, both the adapter's business: a tool the model called that
    // failed, and a transcript line this parser could not read. Neither is a finding about
    // anyone's brand, and both are invisible unless recorded here.
    toolErrors: [
      ...t.toolErrors,
      ...(t.unparsedLines ? [`${t.unparsedLines} transcript line(s) did not parse`] : []),
    ],
    toolTimeline: t.toolTimeline,
    turns: t.turns,
    unparsedLines: t.unparsedLines,
    model: t.model,
  };
}
