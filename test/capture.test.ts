import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { testDb, type Db } from "@/db/client";
import { createProject } from "@/db/repo";
import { pendingRuns, planWave, recordRun, savePromptSet } from "@/db/waves";
import { importPromptSet } from "@/lib/import-prompts";
import { runs as runsTable, sources as sourcesTable } from "@/db/schema";
import type { RunOutcome } from "@/runner/types";

/**
 * What a wave stores is all a later reader ever has.
 *
 * Every test here guards one rule: a field the adapter extracted and the store dropped is
 * gone for good. The imported v6 wave is permanently missing its citations for exactly
 * that reason, and no amount of re-grading brings them back.
 */

let db: Db;
let waveId: number;

const outcome = (over: Partial<RunOutcome> = {}): RunOutcome => ({
  text: "Render is a solid choice.",
  stopReason: "end_turn", truncated: false,
  searchCount: 2, searchUnit: "claude-cli.websearch_calls",
  searchQueries: ["where to deploy a go api", "render vs fly pricing"],
  sources: [{ url: "https://render.com/docs", kind: "fetch", rank: 1 }],
  inputTokens: 100, outputTokens: 50,
  toolErrors: [],
  raw: { ok: true }, modelResolved: "claude-sonnet-5", costUsd: 0, durationMs: 10,
  ...over,
});

beforeEach(() => {
  db = testDb();
  const projectId = createProject(db, {
    slug: "acme", name: "Acme",
    brand: { name: "Acme", aliases: ["Acme"], domains: ["acme.dev"] },
    competitors: [{ name: "Render", aliases: ["Render"], domains: ["render.com"] }],
  }).id;
  const setId = savePromptSet(db, projectId, importPromptSet({
    version: "v1",
    prompts: [{ id: "a", prompt: "Where should I deploy a Go API?", category: "frameworks" }],
  })).id;
  waveId = planWave(db, {
    projectId, promptSetId: setId, name: "w1",
    surfaces: [{
      surfaceKey: "chat.cli.claude", label: "Claude Code", modelRequested: "claude-sonnet-5",
      reps: 1, config: {},
    }],
  }).id;
});

const first = () => pendingRuns(db, waveId)[0];
const storedRun = () => db.select().from(runsTable).all()[0];

describe("the store keeps what the adapter extracted", () => {
  it("keeps the queries the engine actually ran", () => {
    const p = first();
    recordRun(db, p.cellId, p.rep, outcome());
    expect(storedRun().searchQueries).toEqual(["where to deploy a go api", "render vs fly pricing"]);
  });

  /**
   * A failed server tool still returns prose, so the run looks healthy from outside. Losing
   * this is how "the search found nothing about the brand" and "the search did not happen"
   * become the same row.
   */
  it("keeps tool failures, which are otherwise invisible", () => {
    const p = first();
    recordRun(db, p.cellId, p.rep, outcome({ toolErrors: ["WebSearch: upstream timeout"] }));
    expect(storedRun().toolErrors).toEqual(["WebSearch: upstream timeout"]);
  });

  it("keeps the ordered tool calls behind an adoption verdict", () => {
    const p = first();
    recordRun(db, p.cellId, p.rep, outcome({
      toolTimeline: [
        { seq: 1, tool: "WebSearch", detail: "go api hosting" },
        { seq: 2, tool: "WebFetch", detail: "https://render.com/docs" },
        { seq: 3, tool: "Write", detail: "render.yaml" },
      ],
    }));
    expect(storedRun().toolTimeline.map((t) => t.tool)).toEqual(["WebSearch", "WebFetch", "Write"]);
    expect(storedRun().toolTimeline[2].detail).toBe("render.yaml");
  });

  /** An adapter that reports nothing must store empty, never null — the column is read directly. */
  it("defaults to empty rather than null when an adapter reports nothing", () => {
    const p = first();
    recordRun(db, p.cellId, p.rep, outcome({ searchQueries: [], toolErrors: [] }));
    const r = storedRun();
    expect(r.searchQueries).toEqual([]);
    expect(r.toolErrors).toEqual([]);
    expect(r.toolTimeline).toEqual([]);
  });
});

describe("a run and its sources are stored atomically", () => {
  /**
   * The run row and its sources are two writes. Without a transaction, a crash between them
   * leaves a run that searched and stored nothing — which `waveHealth` reads as an
   * extraction fault and reports as a finding. One power cut in an unattended overnight wave
   * would manufacture a false conclusion about somebody's product.
   */
  it("leaves no run behind when writing its sources fails", () => {
    const p = first();
    const poisoned = outcome({
      // `url` is NOT NULL, so this row is rejected after the run row is already inserted.
      sources: [{ url: undefined as unknown as string, kind: "fetch", rank: 1 }],
    });

    expect(() => recordRun(db, p.cellId, p.rep, poisoned)).toThrow();

    // The run must not survive its sources failing, or "no sources" stops meaning no sources.
    expect(db.select().from(runsTable).all()).toHaveLength(0);
    expect(db.select().from(sourcesTable).all()).toHaveLength(0);
    // And the cell is still owed, so the resume picks it up rather than skipping it.
    expect(pendingRuns(db, waveId).some((r) => r.cellId === p.cellId && r.rep === p.rep)).toBe(true);
  });

  it("commits the run and every source together on success", () => {
    const p = first();
    recordRun(db, p.cellId, p.rep, outcome({
      sources: [
        { url: "https://render.com/docs", kind: "fetch", rank: 1 },
        { url: "https://fly.io/docs", kind: "search_result", rank: 2 },
      ],
    }));
    const run = storedRun();
    expect(db.select().from(sourcesTable).where(eq(sourcesTable.runId, run.id)).all()).toHaveLength(2);
  });
});

/**
 * The standing audit.
 *
 * Every field the adapters produce must either reach a column or be deliberately excluded
 * with a reason. Adding a field to `RunOutcome` and forgetting `recordRun` is precisely how
 * the citations were lost, and it is the kind of omission no reviewer notices — so it is
 * checked here rather than remembered.
 */
describe("no field is extracted and then dropped", () => {
  const DISPOSITION: Record<keyof RunOutcome, string> = {
    text: "runs.text",
    stopReason: "runs.stop_reason",
    truncated: "runs.truncated",
    searchCount: "runs.search_count",
    searchUnit: "runs.search_unit",
    searchQueries: "runs.search_queries",
    sources: "sources table, one row each",
    inputTokens: "runs.input_tokens",
    outputTokens: "runs.output_tokens",
    toolErrors: "runs.tool_errors",
    toolTimeline: "runs.tool_timeline",
    raw: "runs.raw_response, verbatim",
    modelResolved: "runs.model_resolved",
    toolVersion: "runs.tool_version",
    costUsd: "runs.cost_usd_micros, scaled",
    durationMs: "runs.duration_ms",
  };

  it("accounts for every field an adapter can produce", () => {
    // A fully-populated outcome, so the key list is the type's, not a partial's.
    const full: RunOutcome = {
      ...outcome(),
      toolTimeline: [{ seq: 1, tool: "WebSearch" }],
      toolVersion: "2.1.259 (Claude Code)",
    };
    const undeclared = Object.keys(full).filter((k) => !(k in DISPOSITION));
    expect(undeclared,
      `these RunOutcome fields have no recorded disposition — persist them or say why not: ${undeclared.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The agent surface returns more than a chat surface does — the verdict, the files it
   * changed, what it read — and none of that has a column of its own. It travels inside
   * `raw`, and this is the list of what must be in there, so a field added to the surface
   * and left out of the raw record fails here rather than after a wave.
   */
  it("accounts for every field the agent surface adds", () => {
    const AGENT_RAW: Record<string, string> = {
      stdout: "the transcript, verbatim",
      stderr: "tail of stderr",
      exitCode: "process exit code",
      timedOut: "whether the timeout fired",
      repoUrl: "which repository",
      baseSha: "the commit the agent started from",
      changedFiles: "every path it touched — the ladder's first tier",
      fileBodies: "bodies of those files, bounded — the ladder's deploy-artifact tier",
      fetches: "pages it opened — the decision mode",
      adoption: "the verdict reached on the night, beside its inputs",
    };
    const AGENT_TOP: Record<string, string> = {
      adopted: "raw.adoption.adopted",
      adoptionSource: "raw.adoption.source",
      adoptionEvidence: "raw.adoption.evidence",
      adoptionConflict: "raw.adoption.conflict",
      decisionMode: "raw.adoption.decisionMode",
      changedFiles: "raw.changedFiles",
      baseSha: "raw.baseSha",
    };
    // The keys the surface actually emits, read off its source so the list cannot drift.
    const src = readFileSync(new URL("../src/runner/surfaces/agent-repo.ts", import.meta.url), "utf8");
    const rawStart = src.lastIndexOf("raw: {");
    const rawBlock = src.slice(rawStart, src.indexOf("modelResolved:", rawStart));
    for (const key of Object.keys(AGENT_RAW)) {
      expect(rawBlock, `agent-repo.ts no longer stores '${key}' in raw — ${AGENT_RAW[key]}`).toMatch(new RegExp(`\\b${key}\\b`));
    }
    const resultBlock = src.slice(src.lastIndexOf("return {"));
    for (const key of Object.keys(AGENT_TOP)) {
      expect(resultBlock, `agent-repo.ts no longer returns '${key}'`).toMatch(new RegExp(`\\b${key}\\b`));
    }
  });

  it("round-trips every stored field for real", () => {
    const p = first();
    recordRun(db, p.cellId, p.rep, outcome({
      text: "answer", stopReason: "end_turn", searchCount: 3,
      searchQueries: ["q1"], toolErrors: ["e1"],
      toolTimeline: [{ seq: 1, tool: "WebSearch", detail: "q1" }],
      inputTokens: 11, outputTokens: 22, durationMs: 33,
      modelResolved: "claude-sonnet-5", toolVersion: "2.1.259 (Claude Code)", costUsd: 0.000123,
      raw: { marker: "verbatim" },
    }));
    const r = storedRun();
    expect(r).toMatchObject({
      text: "answer", stopReason: "end_turn", searchCount: 3,
      inputTokens: 11, outputTokens: 22, durationMs: 33,
      modelResolved: "claude-sonnet-5", toolVersion: "2.1.259 (Claude Code)",
    });
    expect(r.searchQueries).toEqual(["q1"]);
    expect(r.toolErrors).toEqual(["e1"]);
    expect(r.toolTimeline).toEqual([{ seq: 1, tool: "WebSearch", detail: "q1" }]);
    expect(JSON.parse(r.rawResponse!)).toEqual({ marker: "verbatim" });
    // Cost is stored in micros so it stays an integer.
    expect(r.costUsd).toBe(123);
  });
});
