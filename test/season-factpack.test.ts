import { describe, expect, it } from "vitest";
import s0File from "../data/published/hosting-s0-wave3.json";
import s1File from "../data/published/hosting-s1-opus55.json";
import type { PublishedDataset } from "@/derive/load-dataset";
import {
  agreementWithout,
  harnessMentions,
  rowOfPublished,
  seasonFacts,
  seasonPair,
  stubsInCommand,
  TRIMMED_FORKS,
  untracedNumbers,
} from "@/derive/season-factpack";

const d0 = s0File as unknown as PublishedDataset;
const d1 = s1File as unknown as PublishedDataset;
type Published = { adoption: { platform: string; adopted: number; ci?: { lo: number; hi: number } }[]; stability: unknown };

describe("seasonFacts reproduces the published file", () => {
  it.each([["season 0", d0], ["season 1", d1]])("%s: every share interval and the stability block", (_, d) => {
    const f = seasonFacts(d);
    const pub = d as unknown as Published;
    for (const a of pub.adoption.filter((x) => x.adopted > 0)) {
      const mine = f.shares.find((s) => s.platform === a.platform);
      expect(mine?.n, a.platform).toBe(a.adopted);
      expect(mine?.interval, a.platform).toEqual(a.ci);
    }
    expect(f.stability).toEqual(pub.stability);
  });
});

describe("seasonPair", () => {
  const p = seasonPair(d0, d1);

  it("gives the result docs/SEASONS.md records for 17 October 2026", () => {
    expect([p.constrained.agreeing, p.constrained.comparable]).toEqual([20, 31]);
    expect(Math.round(p.constrained.interval!.lo * 100)).toBe(48);
    expect(Math.round(p.constrained.interval!.hi * 100)).toBe(80);
    expect(p.verdict).toBe("reset");
    expect(p.overlap).toEqual({ lo: 0.77, hi: 0.8 });
  });

  it("finds Netlify the only platform outside season 0's interval", () => {
    expect(p.moved.map((m) => m.platform)).toEqual(["Netlify"]);
    expect(p.newInS1.map((s) => s.platform)).toEqual(["Oracle Cloud"]);
  });

  it("counts named against chosen outside the open brief", () => {
    const railway = p.s1.namedChosen.find((x) => x.platform === "Railway");
    expect(railway).toMatchObject({ named: 39, chosen: 0 });
    // Chosen in season 0 and never named there: the row must still count the choices.
    expect(p.s0.namedChosen.find((x) => x.platform === "Streamlit Community Cloud")).toMatchObject({ named: 0, chosen: 6 });
    expect(p.s0.decisionModes.find((x) => x.frame === "outside open")?.prior).toBe(53);
    expect(p.s1.decisionModes.find((x) => x.frame === "outside open")?.prior).toBe(63);
  });
});

describe("untracedNumbers", () => {
  const pack = "Agreeing: 20 of 31 (65%). Pages: 195. See run 232.";

  it("passes a draft whose every figure is in the pack", () => {
    expect(untracedNumbers("We saw 20 of 31 cells (65%) and 195 pages, run 232.", pack)).toEqual([]);
  });

  it("matches a count with its denominator, not its parts", () => {
    expect(untracedNumbers("Only 20 of 33 agreed.", pack)).toEqual(["20 of 33"]);
  });

  it("flags an invented percentage and run id, and skips code spans", () => {
    expect(untracedNumbers("About 66% in run 233, with `--floor-lo 0.77`.", pack)).toEqual(["66%", "run 233"]);
  });
});

describe("agreementWithout", () => {
  it("holds the verdict without the three trimmed forks", () => {
    const r = agreementWithout(d1.runs.map((x) => rowOfPublished(x, d1)), d0.runs.map((x) => rowOfPublished(x, d0)), TRIMMED_FORKS);
    expect([r.agreeing, r.comparable]).toEqual([16, 23]);
    expect(Math.round(r.interval!.lo * 100)).toBe(50);
    expect(Math.round(r.interval!.hi * 100)).toBe(88);
  });
});

describe("stubsInCommand", () => {
  it("counts a CLI that is run or read by path", () => {
    expect(stubsInCommand("render blueprint validate render.yaml")).toEqual(["Render"]);
    expect(stubsInCommand("cat /opt/shims/railway && npx vercel --version")).toEqual(["Railway", "Vercel"]);
  });

  it("skips an existence check and a file that only shares the name", () => {
    expect(stubsInCommand("which render flyctl; command -v railway")).toEqual([]);
    expect(stubsInCommand("cat fly.toml render.yaml")).toEqual([]);
  });
});

describe("harnessMentions", () => {
  it("finds no closing text that calls the run a test or a benchmark", () => {
    expect(harnessMentions(d0).harness).toEqual([]);
    expect(harnessMentions(d1).harness).toEqual([]);
  });
});
