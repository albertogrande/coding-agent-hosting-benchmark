import { describe, expect, it } from "vitest";
import published from "../data/published/hosting-s0-wave3.json";
import { testDb } from "@/db/client";
import { loadPublished } from "@/db/load-published";
import { agentRunRows } from "@/db/agent-runs";
import { gradesFor } from "@/db/waves";
import { getProject } from "@/db/repo";
import {
  epoch, gradeFor, outcomeFor, planLoad, rawFor, type PublishedDataset, type PublishedRun,
} from "@/derive/load-dataset";

const data = published as unknown as PublishedDataset;

/**
 * The reproduce path the report sells is "download the dataset, re-grade it, minutes, no
 * login". It did not work: grading reads SQLite, `data/*.db` is gitignored, and nothing read
 * `data/published/`. These tests are the thing that makes the claim checkable.
 */
describe("planLoad", () => {
  it("refuses a schema it does not understand rather than guessing at the mapping", () => {
    expect(() => planLoad({ ...data, schema: "aeo-tool/wave-dataset/9" }))
      .toThrow(/not one this loader understands/);
  });

  it("refuses a run that names a prompt the dataset does not carry", () => {
    const runs = [{ ...data.runs[0], promptKey: "ghost" }] as PublishedRun[];
    expect(() => planLoad({ ...data, runs })).toThrow(/prompts the dataset does not carry/);
  });

  it("refuses a run that names a repository the design does not list", () => {
    const runs = [{ ...data.runs[0], repository: { id: "not-a-repo" } }] as PublishedRun[];
    expect(() => planLoad({ ...data, runs })).toThrow(/repositories the design does not list/);
  });

  /**
   * The frame a run is bucketed under is the prompt's `shape` — that is what `agentRunRows`
   * reads back. Taking it from anywhere else would silently re-bucket all 132 runs.
   */
  it("carries each prompt's frame as its shape", () => {
    const plan = planLoad(data);
    expect(plan.prompts.map((p) => p.shape).sort())
      .toEqual(["cost", "least-effort", "open", "production"]);
  });

  it("names what a published record cannot restore, instead of leaving it to be discovered", () => {
    const plan = planLoad(data);
    expect(plan.losses.join(" ")).toMatch(/transcript/);
    expect(plan.losses.join(" ")).toMatch(/tokens and cost/);
  });

  it("restores the tool timeline from schema 3, and names it as lost from a file that published a count", () => {
    expect(planLoad(data).losses.join(" ")).not.toMatch(/tool timeline/);
    const counted = { ...data, schema: "aeo-tool/wave-dataset/2", runs: data.runs.map((r) => ({ ...r, toolTimeline: 12 })) };
    expect(planLoad(counted).losses.join(" ")).toMatch(/tool timeline/);
  });
});

describe("mapping one published run", () => {
  const run = data.runs.find((r) => r.changedFiles?.length && r.pagesOpened?.length)!;

  it("rebuilds the blob agentRunRows reads the agent half of a run out of", () => {
    const raw = rawFor(run);
    expect(raw.changedFiles).toEqual(run.changedFiles);
    expect(raw.repoUrl).toBe(run.repository.repoUrl ?? null);
    expect((raw.adoption as Record<string, unknown>).source).toBe(run.adoptionSource);
    // A loaded store must not be mistakable for one a wave wrote.
    expect(raw.loadedFromPublished).toBe(true);
  });

  it("derives the search count from the queries rather than inventing one", () => {
    expect(outcomeFor(run).searchCount).toBe(run.searchQueries.length);
  });

  /**
   * `toolTimeline: 41` says a run made 41 tool calls and nothing about what they were.
   * Fabricating 41 placeholders would render a timeline of nothing and read as data.
   */
  it("does not fabricate a tool timeline from a count", () => {
    const counted = { ...run, toolTimeline: 41, toolErrors: 2 } as unknown as PublishedRun;
    expect(outcomeFor(counted).toolTimeline).toEqual([]);
    expect(outcomeFor(counted).toolErrors).toEqual([]);
  });

  it("turns every page opened into a source", () => {
    expect(outcomeFor(run).sources).toHaveLength(run.pagesOpened.length);
  });

  it("reads a timestamp whether it arrives as ISO or as epoch millis", () => {
    expect(epoch("2026-09-10T00:00:00Z")).toBe(Date.parse("2026-09-10T00:00:00Z"));
    expect(epoch(1757462400000)).toBe(1757462400000);
    expect(epoch(null)).toBe(null);
    expect(epoch("not a date")).toBe(null);
  });

  it("keeps a reviewer's relabel, which no re-grade can reproduce", () => {
    const reviewed = data.runs.find((r) => r.reviewNote)!;
    const g = gradeFor(reviewed)!;
    expect(g.reviewNote).toBe(reviewed.reviewNote);
    expect(g.reviewedAt).toBe(epoch(reviewed.reviewedAt));
    expect(g.winner).toBe(reviewed.adopted);
  });

  it("returns no grade for a run the dataset never graded", () => {
    expect(gradeFor({ ...run, reach: null } as PublishedRun)).toBe(null);
  });
});

/**
 * The round trip, against the real 132-run record. This is the test that would have caught
 * the broken reproduce path: it loads the published file into an empty database and reads it
 * back through the same function the report renders from.
 */
describe("the round trip through a real store", () => {
  const db = testDb();
  const result = loadPublished(db, data, { slug: "hosting", file: "test" });

  it("loads every run in the dataset, with nothing skipped", () => {
    expect(result.loaded).toBe(data.runs.length);
    expect(result.skipped).toEqual([]);
  });

  /**
   * Every review file, published figure and backlog note names a run by the id it was
   * recorded under. A reload that renumbered them would leave a store that reproduces the
   * season's numbers exactly and still fails `npm run review -- <file>` on every row.
   */
  it("keeps each run's published id", () => {
    const rows = agentRunRows(db, result.waveId);
    expect(rows.map((r) => r.runId).sort((a, b) => a - b))
      .toEqual(data.runs.map((r) => r.runId).sort((a, b) => a - b));
  });

  it("plans the design the dataset describes: 11 repositories × 4 frames", () => {
    const rows = agentRunRows(db, result.waveId);
    expect(new Set(rows.map((r) => r.target)).size).toBe(data.design.repositories.length);
    expect(new Set(rows.map((r) => r.frame)).size).toBe(4);
  });

  it("stores the published grades at the dataset's version, not today's", () => {
    // A re-grade then writes the current version beside these, so the two are a diff.
    expect(result.graderVersion).toBe(data.graderVersion);
    expect(gradesFor(db, result.waveId).length).toBe(result.gradesWritten);
  });

  /**
   * The published verdicts have to survive the trip byte for byte. Read back through
   * `agentRunRows` at the dataset's grader version they are the same labels the page shows —
   * anything else means the loader, not the grader, changed the season's numbers.
   */
  it("reads back the same adopted platform for every run", () => {
    const rows = agentRunRows(db, result.waveId);
    const byCell = new Map(
      rows.map((r) => [`${r.frame} ${r.target} ${r.rep}`, r] as const),
    );
    const wrong: string[] = [];
    for (const run of data.runs) {
      const got = byCell.get(`${run.frame} ${run.repository.id} ${run.rep}`);
      if (!got) { wrong.push(`run ${run.runId}: not found after loading`); continue; }
      if (got.text !== (run.closingMessage ?? "")) wrong.push(`run ${run.runId}: closing text changed`);
      if ((got.changedFiles ?? []).length !== (run.changedFiles ?? []).length) {
        wrong.push(`run ${run.runId}: changed files changed`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

/**
 * The alias lists are the one loss that moves a published figure rather than a detail, so it
 * is asserted rather than left in a comment. A reader who rebuilds the store and reports
 * "Cloudflare named 20" has contradicted the page without being told why.
 */
describe("what a reload cannot reproduce", () => {
  it("says that named counts do not survive, because alias lists are not published", () => {
    // A version 1 file, as season 0's dataset was until it was regenerated under version 2.
    const v1: PublishedDataset = { ...data, schema: "aeo-tool/wave-dataset/1", platforms: undefined };
    const plan = planLoad(v1);
    expect(plan.losses.join(" ")).toMatch(/alias lists/);
    expect(plan.losses.join(" ")).toMatch(/named/);
  });
});

/**
 * From version 2 the record carries its vocabulary, so the one loss that moved a published
 * figure is closed rather than declared.
 */
describe("a dataset that publishes its alias lists", () => {
  const vocabulary = [
    { name: "Cloudflare", aliases: ["Cloudflare", "Workers", "Pages"], domains: ["cloudflare.com"] },
    { name: "Fly.io", aliases: ["Fly.io", "Fly"], domains: ["fly.io"] },
  ];
  const v2: PublishedDataset = { ...data, schema: "aeo-tool/wave-dataset/2", platforms: vocabulary };

  it("stops declaring named counts a loss", () => {
    const plan = planLoad(v2);
    expect(plan.platforms).toEqual(vocabulary);
    expect(plan.losses.join(" ")).not.toMatch(/alias lists/);
  });

  it("refuses a version 2 file with no alias lists, rather than guessing at the spellings", () => {
    expect(() => planLoad({ ...v2, platforms: [] })).toThrow(/alias lists/);
    expect(() => planLoad({ ...v2, platforms: undefined })).toThrow(/alias lists/);
  });

  it("seeds the store from the published spellings and nothing else", () => {
    const db = testDb();
    loadPublished(db, v2, { slug: "hosting-v2", file: "test" });
    const competitors = getProject(db, "hosting-v2")!.competitors;
    expect(competitors.find((c) => c.name === "Cloudflare")).toEqual(vocabulary[0]);
    expect(competitors.find((c) => c.name === "Fly.io")).toEqual(vocabulary[1]);
    // Render is adopted in the runs and absent from this list. It stays unlisted, as a
    // platform outside a published vocabulary was when the wave ran: a reload that seeded it
    // would count it as "named" and the published counts would not come back.
    expect(competitors.find((c) => c.name === "Render")).toBeUndefined();
    expect(competitors).toHaveLength(vocabulary.length);
  });
});

/**
 * A re-grade from the published file reads the same evidence the store had. The decision mode
 * comes from the pages a run fetched; a loader that dropped them called a third of season 1's
 * runs "prior" that had read a page.
 */
describe("what a re-grade reads back", () => {
  it("restores the pages a run fetched and the effort it ran at", async () => {
    const { rawFor } = await import("@/derive/load-dataset");
    const run = {
      ...data.runs[0],
      sandbox: { image: "aeo-sandbox:s1", digest: "sha256:c5e3", effort: "high" },
      pagesOpened: [
        { url: "https://render.com/docs/free", host: "render.com", kind: "fetch", rank: 1 },
        { url: "https://fly.io/pricing", host: "fly.io", kind: "search", rank: 2 },
      ],
    } as unknown as Parameters<typeof rawFor>[0];
    const raw = rawFor(run) as { fetches: string[]; sandbox: { effort: string | null } };
    expect(raw.fetches).toEqual(["https://render.com/docs/free"]);
    expect(raw.sandbox.effort).toBe("high");
  });
});
