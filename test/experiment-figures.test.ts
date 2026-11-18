import { describe, expect, it } from "vitest";
import { experimentFigures, experimentLines, wilson } from "@/derive/experiment-figures";
import { experimentInputs } from "@/lib/experiment-inputs";

// Every November figure "How Claude Code picks a host" prints, as `npm run figures` computes
// it from each experiment's analysis file and stored runs. A failure here means the page and
// this record no longer agree.
const f = experimentFigures(experimentInputs("https://thebeat.dev/research/how-claude-code-picks-a-host/"));
const n = (x: { n: number; of: number }) => `${x.n}/${x.of}`;

describe("the November figures reproduce from the stored experiments", () => {
  it("counts every batch of runs in the record", () => {
    expect(f.record.runs).toBe(1133);
    expect(f.record.batches.map((b) => b.runs)).toEqual([132, 132, 132, 132, 44, 99, 66, 198, 198]);
  });

  it("an AGENTS.md that names Railway", () => {
    const a = f.agentsMd;
    expect([n(a.railway.without), n(a.railway.with)]).toEqual(["1/99", "96/99"]);
    expect([a.railway.points, a.railway.lo, a.railway.hi]).toEqual([96, 89, 98]);
    expect(a.byBrief.map((b) => [b.brief, n(b.with)])).toEqual([["least-effort", "33/33"], ["production", "33/33"], ["cost", "30/33"]]);
    expect([n(a.majority.without), n(a.majority.with)]).toEqual(["0/33", "32/33"]);
    expect([n(a.memory.without), n(a.memory.with), a.memory.points]).toEqual(["33/99", "55/99", 22]);
    expect([n(a.railwayDocs.without), n(a.railwayDocs.with)]).toEqual(["4/99", "37/99"]);
    expect([n(a.cited), n(a.opened), n(a.neverInToolOutput)]).toEqual(["93/99", "53/99", "45/99"]);
    expect([n(a.scriptLabels.with), a.scriptLabels.points]).toEqual(["88/99", 88]);
  });

  it("a Railway config file already in the repo", () => {
    const c = f.config;
    expect([n(c.railway.without), n(c.railway.with)]).toEqual(["0/99", "64/99"]);
    expect([c.railway.points, c.railway.lo, c.railway.hi]).toEqual([65, 54, 73]);
    expect(c.byBrief.map((b) => [b.brief, n(b.with), b.kept, b.edited])).toEqual([
      ["least-effort", "27/33", 10, 23], ["production", "30/33", 1, 32], ["cost", "7/33", 33, 0],
    ]);
    expect([n(c.majority.with), n(c.memory.without), n(c.memory.with)]).toEqual(["22/33", "35/99", "49/99"]);
    expect([n(c.railwayDocs.without), n(c.railwayDocs.with)]).toEqual(["3/99", "40/99"]);
    expect([n(c.configLeftInRepo), n(c.leftAndPickedAnother)]).toEqual(["99/99", "35/99"]);
    expect(c.cheapestPicks.slice(0, 3)).toEqual([{ host: "Render", n: 8 }, { host: "Fly.io", n: 7 }, { host: "Railway", n: 7 }]);
  });

  it("the two checks of the setup", () => {
    expect([n(f.stubs.matchesPublishedPick.asPublished), n(f.stubs.matchesPublishedPick.none), n(f.stubs.samePick)]).toEqual(["29/33", "31/33", "30/33"]);
    expect([n(f.stubs.memory.asPublished), n(f.stubs.memory.none)]).toEqual(["8/33", "5/33"]);
    expect([n(f.cli.memory.older), n(f.cli.memory.newer), f.cli.memory.lo, f.cli.memory.hi]).toEqual(["16/33", "13/33", -6, 23]);
    expect(n(f.cli.samePick)).toBe("25/33");
    expect([n(f.cli.imagesRebuiltAfter), n(f.config.signInChangedAfter)]).toEqual(["27/66", "164/198"]);
  });

  it("decided from memory, group by group", () => {
    expect(f.memory.groups.map((g) => n(g))).toEqual(["51/99", "50/99", "8/33", "13/33", "33/99", "35/99"]);
    expect(n(f.memory.october)).toBe("101/198");
    expect(f.memory.october.byBrief.map((b) => n(b))).toEqual(["46/66", "39/66", "16/66"]);
    expect(f.unchanged.memoryByBrief.map((b) => n(b))).toEqual(["55/88", "23/88", "11/88"]);
    expect(n(f.memory.october.secondNightMatchesFirst)).toBe("86/99");
    expect(n(f.memory.october.railwayPicked)).toBe("0/198");
  });

  it("counts the unchanged November runs by October's rules", () => {
    const u = f.unchanged;
    expect(u.runs).toBe(264);
    expect(u.decided).toEqual({ prior: 89, fetch: 122, shell: 37, search: 16 });
    expect(n(u.matchesPublishedPick)).toBe("231/264");
    // The stubs group, counted here, matches the registered analysis of the same runs.
    expect(n(u.byGroup[0].matchesPublishedPick)).toBe(n(f.stubs.matchesPublishedPick.asPublished));
    expect([n(u.docs.straightToPick), n(u.docs.firstReadPicked), n(u.docs.onlyReadPicked)]).toEqual(["97/143", "125/143", "111/143"]);
    expect([n(u.comparedCost), n(u.comparedElsewhere)]).toEqual(["22/88", "6/176"]);
    expect([n(u.docs.otherPlatformReads), n(u.docs.otherReadsCheapest)]).toEqual(["81/640", "68/81"]);
    const railway = u.namedPicked.find((r) => r.platform === "Railway")!;
    expect([n(railway.named), n(railway.picked)]).toEqual(["44/264", "2/264"]);
    expect(u.winners.map((w) => [w.top, n(w.topShare)])).toEqual([["Render", "64/88"], ["Fly.io", "43/88"], ["Fly.io", "23/88"]]);
  });

  it("counts the runs a reviewer labelled", () => {
    expect(f.labels.reviewed.map((r) => r.reviewed)).toEqual([16, 11, 25, 20]);
    expect(n(f.labels.reviewedTotal)).toBe("72/561");
  });

  it("prints a line for every figure", () => {
    expect(experimentLines(f).length).toBeGreaterThan(60);
    expect(wilson(96, 99)).toMatchObject({ pct: 97, lo: 91, hi: 99 });
  });
});
