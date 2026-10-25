/**
 * The dataset the case study on thebeat.dev computes every figure from: one row per run of
 * the two seasons, reshaped from the published files and nothing else.
 *
 * It used to be cut by hand from an earlier artifact, with its own rule for `named`, so the
 * page and this record counted Railway as named in 23 and 39 runs. Now the page's file is
 * this function's output: every label, mode and name is the published one, and the only
 * derived fields are the read order and each call's read flag, both from the grader's own
 * modules. Pure, so `scripts/export-site.mts` writes it and a test pins it.
 */
import type { PublishedDataset, PublishedRun } from "./load-dataset";
import { readOrder, type ReadOrder } from "./read-order";
import { shellReads } from "./shell-lookups";

/** The page's name for each served model. */
export const MODEL_LABEL: Record<string, string> = {
  "claude-opus-5": "Opus 5",
  "claude-opus-5-5": "Opus 5.5",
};

/**
 * The opening of each brief, as the page quotes it. The full wording is in
 * `prompts/hosting-s0.json`; the page links to it.
 */
export const BRIEF_OPENING: Record<string, string> = {
  "least-effort": "Get this app off localhost with the least ongoing effort from me.",
  production: "This needs to run in production for real users: a custom domain with HTTPS, restarts if it crashes, and logs I can read.",
  cost: "I want to put this app online as cheaply as possible - ideally free, and if not, the lowest predictable monthly bill.",
  open: "Deploy this repository. You decide where and how.",
};

/** A call's detail is cut here: the page lists calls, the transcripts carry them whole. */
export const DETAIL_CUT = 300;

export type ReadFlag = "web" | "docs" | "lookup" | "net" | "";
export type SiteCall = [tool: string, detail: string, flag: ReadFlag];
export type SiteRun = {
  run: number;
  model: string;
  brief: string;
  app: string;
  decided: string | null;
  picked: string | null;
  order: ReadOrder;
  named: string[];
  calls: SiteCall[];
};

type Event = { tool: string; detail?: string };

/**
 * What a call read. `web` is a web tool; `docs` and `lookup` are web content read from the
 * shell (`docs` on a hosting platform's own docs site); `net` is any other curl or wget, which
 * `shellReads` does not count as reading (an install, a probe, a call to the app).
 */
export function readFlag(e: Event): ReadFlag {
  if (e.tool === "WebSearch" || e.tool === "WebFetch") return "web";
  if (e.tool !== "Bash") return "";
  const reads = shellReads(e.detail ?? "");
  if (reads.some((r) => r.kind === "lookup" && r.vendorDocs)) return "docs";
  if (reads.some((r) => r.kind === "lookup")) return "lookup";
  return reads.length ? "net" : "";
}

function siteRun(r: PublishedRun): SiteRun {
  if (!Array.isArray(r.toolTimeline)) throw new Error(`run ${r.runId}: the tool timeline is published as a count, not as calls`);
  const timeline = r.toolTimeline as Event[];
  const model = MODEL_LABEL[r.modelResolved ?? ""];
  if (!model) throw new Error(`run ${r.runId}: no page label for model ${r.modelResolved}`);
  return {
    run: r.runId,
    model,
    brief: r.frame,
    app: r.repository.id,
    decided: r.decisionMode,
    picked: r.adopted ?? null,
    order: readOrder(timeline, r.adopted ?? null),
    named: r.platformsNamed,
    calls: timeline.map((e) => [e.tool, (e.detail ?? "").slice(0, DETAIL_CUT), readFlag(e)]),
  };
}

/** The page's `runs.json`, from the published seasons in the order given. */
export function siteDataset(seasons: PublishedDataset[], study: string) {
  const graders = [...new Set(seasons.map((d) => d.graderVersion))];
  if (graders.length !== 1) throw new Error(`the seasons were graded under different versions: ${graders.join(", ")}`);
  const runs = seasons.flatMap((d) => d.runs).map(siteRun).sort((a, b) => a.run - b.run);
  return {
    title: "Memory first, docs second: every run",
    study,
    grader: graders[0],
    fields: {
      run: "The run id in the benchmark database.",
      model: "Opus 5 (Claude Code 2.1.260, 8 to 10 September 2026) or Opus 5.5 (Claude Code 2.1.280, 15 to 16 October 2026).",
      brief: "least-effort, production, cost or open. The wording is in briefs below.",
      app: "The app the agent was asked to host.",
      decided: "How the agent decided. prior: from memory, no search and no page. search: searched, opened nothing. shell: read a page from the shell. fetch: opened a page.",
      picked: "The platform the agent picked, or null when it picked no outside host.",
      order: "When the first read came relative to the first config file for the pick: read before committing, read only after committing, unknown (no config file for the pick) or no reads.",
      named: "Platforms the agent named in its messages, by the benchmark's alias lists. An ambiguous alias such as Render counts only in its exact case, a generic one such as Workers never alone, and a platform named only as an unavailable tool does not count. The pick always counts.",
      calls: `Every tool call in order, as [tool, detail cut at ${DETAIL_CUT} characters, read flag]. The flag is web for WebSearch and WebFetch, docs or lookup for a shell call that read a web page, net for any other network call, and empty otherwise.`,
    },
    briefs: BRIEF_OPENING,
    count: runs.length,
    runs,
  };
}
