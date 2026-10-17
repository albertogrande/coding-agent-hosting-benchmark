/**
 * Agent rows for the derive tests: two repositories × two frames × two repeats, with one
 * flip, one voided run, one platform outside the catalogue and one undecided run. Shared by
 * the benchmark and dataset tests so both read the same small wave.
 */
import type { AgentRow } from "@/derive/agent-benchmark";
import type { Alias } from "@/db/schema";

export const platforms: Alias[] = [
  { name: "Railway", aliases: ["Railway"], domains: ["railway.com", "railway.app"] },
  { name: "Render", aliases: ["Render"], domains: ["render.com"] },
  { name: "Fly.io", aliases: ["Fly.io", "Fly"], domains: ["fly.io"] },
];

let nextId = 1;
export const row = (over: Partial<AgentRow> = {}): AgentRow => {
  const id = nextId++;
  return {
    runId: id, cellId: 1, rep: 1, status: "ok", truncated: false, stopReason: "end_turn",
    text: "I went with Render.", promptKey: "cost", promptText: "cheaply, please", frame: "cost",
    target: "whoami", surfaceKey: "agent.repo.claude", surfaceLabel: "Claude Code (in-repo)",
    modelRequested: "claude-opus-5", modelResolved: "claude-opus-5", toolVersion: "2.1.260",
    sandbox: { image: "aeo-sandbox:s0", digest: "sha256:2a368b0692e48f3b9a6adfd8bbfe1b2861d873ccb989b32f97ec99a3466896b4", cliVersion: "2.1.260 (Claude Code)" },
    durationMs: 120_000, ranAt: 1_788_500_000, searchCount: 0, searchQueries: [], toolTimeline: [],
    toolErrors: [], sources: [], changedFiles: ["render.yaml"], repoUrl: "https://github.com/x/whoami",
    baseSha: "1ce75d01", account: "alberto@mac", envClean: true, gradeId: id, reach: "decided",
    adopted: "Render", platformsNamed: ["Render"], decisionMode: "prior", evidence: "adopted Render",
    adoptionSource: "config-file", adoptionEvidence: ["config: Render"], adoptionConflict: null,
    needsReview: false, reviewNote: null, reviewedAt: null,
    ...over,
  };
};

/** Two repositories × two frames × two repeats, with one flip and one voided run. */
export function pilot(): AgentRow[] {
  return [
    // whoami, cost: Render twice.
    row({ cellId: 1, rep: 1 }), row({ cellId: 1, rep: 2 }),
    // whoami, open: Render then Fly — a flip.
    row({ cellId: 2, rep: 1, frame: "open", promptKey: "open" }),
    row({ cellId: 2, rep: 2, frame: "open", promptKey: "open", adopted: "Fly.io", platformsNamed: ["Render", "Fly.io"], changedFiles: ["fly.toml"], decisionMode: "search", searchCount: 2, searchQueries: ["cheap go hosting", "fly.io free tier"] }),
    // healthchecks, cost: Railway then a voided run.
    row({ cellId: 3, rep: 1, target: "healthchecks", adopted: "Railway", platformsNamed: ["Railway"], changedFiles: ["railway.json"], decisionMode: "fetch",
      sources: [{ url: "https://docs.railway.com/guides/django", host: "docs.railway.com", kind: "fetch", rank: 1 }, { url: "https://render.com/docs", host: "render.com", kind: "fetch", rank: 2 }] }),
    row({ cellId: 3, rep: 2, target: "healthchecks", reach: "voided", truncated: true, stopReason: "timeout", adopted: null, platformsNamed: [], changedFiles: [], adoptionSource: null, adoptionEvidence: [] }),
    // healthchecks, open: something outside the catalogue, flagged.
    row({ cellId: 4, rep: 1, target: "healthchecks", frame: "open", promptKey: "open", adopted: "PythonAnywhere", platformsNamed: ["PythonAnywhere"], changedFiles: [], adoptionSource: "unlisted", needsReview: true }),
    row({ cellId: 4, rep: 2, target: "healthchecks", frame: "open", promptKey: "open", adopted: null, reach: "considered", platformsNamed: ["Railway", "Render"], changedFiles: [], adoptionSource: "needs-review", needsReview: true }),
  ];
}
