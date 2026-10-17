/**
 * What every chat surface returns, whatever it is underneath.
 *
 * The shape is deliberately wider than "the answer text": the fields that catch an
 * instrument failure — stopReason, truncated, searchUnit, the sources with their kind —
 * are the reason this app exists, so they are part of the contract rather than an
 * optional extra a particular adapter might forget.
 */

/** Where a URL came from. Conflating these is how "the agent never opened a page"
 *  becomes a finding instead of an instrumentation gap. */
export type SourceKind = "citation" | "search_result" | "fetch";

export type ExtractedSource = {
  url: string;
  title?: string;
  kind: SourceKind;
  /** Position within its kind, in the order the provider returned it. */
  rank?: number;
};

/** One tool call, in the order it happened. `detail` is the query, URL or path. */
export type { ToolEvent } from "@/db/schema";
import type { ToolEvent } from "@/db/schema";

export type Extracted = {
  text: string;
  /** Provider verbatim: end_turn, max_tokens, pause_turn, completed, incomplete… */
  stopReason: string | null;
  /**
   * The answer is not complete — it hit an output ceiling or a paused server-tool loop.
   * A truncated run is never graded; it is voided and counted separately.
   */
  truncated: boolean;
  searchCount: number | null;
  /**
   * What searchCount counts. Providers disagree, and the whole point of naming the unit
   * is that a column holding two different units cannot be compared across providers.
   */
  searchUnit: string | null;
  /** The queries the model actually ran, when the provider reports them. */
  searchQueries: string[];
  sources: ExtractedSource[];
  inputTokens: number | null;
  outputTokens: number | null;
  /** Server-tool errors arrive as HTTP 200 with an error object, not an exception. */
  toolErrors: string[];
  /**
   * The tool calls in the order they happened — searched, read that page, wrote this file.
   * Counts say how much an engine did; the sequence says how it decided, which is the
   * evidence behind an adoption verdict rather than a summary of it. Empty where the
   * adapter has no transcript to read.
   */
  toolTimeline?: ToolEvent[];
};

export type RunOutcome = Extracted & {
  /** The provider response verbatim, so any extraction bug is fixable in hindsight. */
  raw: unknown;
  /**
   * The model that actually answered, as the provider or the transcript reports it — never
   * the one that was asked for. Null when nothing in the response says, which the health
   * card reports as unknown rather than as agreement.
   */
  modelResolved: string | null;
  /**
   * The release of the CLI (or SDK) that produced the run. A model is half of what
   * answered: the CLI's system prompt and tool stack move between releases, and two waves
   * on the same model and different releases are not the same instrument.
   */
  toolVersion?: string | null;
  costUsd: number | null;
  durationMs: number;
};

/** Per-surface settings, snapshotted onto the wave so a run stays interpretable. */
export type SurfaceConfig = {
  model: string;
  /** Never defaulted silently: a low ceiling is how 12 answers became "absent". */
  maxOutputTokens?: number;
  searchEnabled?: boolean;
  /** How many times to resume a paused server-tool loop before giving up. */
  maxResumes?: number;
  timeoutMs?: number;
};

export interface ChatSurface {
  key: string;
  /** Human label used in reports. */
  label(cfg: SurfaceConfig): string;
  /** Dollars per million input/output tokens, for the cost cap. */
  price(model: string): { input: number; output: number };
  run(prompt: string, cfg: SurfaceConfig): Promise<RunOutcome>;
}
