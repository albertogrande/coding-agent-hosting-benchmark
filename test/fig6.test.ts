import { describe, expect, it } from "vitest";
import w2 from "../data/published/hosting-s0-full.json";
import w3 from "../data/published/hosting-s0-wave3.json";
import w5 from "../data/published/hosting-s1-opus55.json";
import w6 from "../data/published/hosting-s1-control-opus5.json";
import w7 from "../data/published/hosting-s1-night2-opus55.json";
import type { PublishedDataset } from "@/derive/load-dataset";
import { splitByProvenance } from "@/derive/benchmark";
import { OPEN, rowOfPublished } from "@/derive/season-factpack";
import { agreementWithInterval, controlReadout } from "@/derive/season-compare";

// Fig. 6 of "Memory first, docs second", recomputed from the five published files with the
// rows `npm run compare` reads. A change here changes a published figure.
const rows = (f: unknown) => {
  const d = f as PublishedDataset;
  const all = d.runs.map((r) => rowOfPublished(r, d)).filter((r) => r.status !== "error");
  return splitByProvenance(all).usable.filter((r) => r.frame !== OPEN);
};
const [s0f, s0, s1, ctl, s1n2] = [w2, w3, w5, w6, w7].map(rows);

describe("Fig. 6 reproduces from the published files", () => {
  it.each([
    ["Opus 5.5 floor: night 2 against night 1", s1n2, s1, 28, 32],
    ["Opus 5 floor: wave 3 against wave 2", s0, s0f, 27, 31],
    ["the update: Opus 5.5 against Opus 5", s1, s0, 20, 31],
    ["the update again: night 2 against Opus 5", s1n2, s0, 21, 32],
  ])("%s", (_, a, b, agreeing, comparable) => {
    const r = agreementWithInterval(a, b);
    expect([r.agreeing, r.comparable]).toEqual([agreeing, comparable]);
  });

  it("the control answers 8 of 11 changed cells like Opus 5", () => {
    const x = controlReadout(ctl, s0, s1);
    expect([x.changed.length, x.sideS0, x.sideS1, x.neither]).toEqual([11, 8, 3, 0]);
    expect([x.matchS0.matching, x.matchS0.cells, x.matchS1.matching, x.matchS1.cells]).toEqual([28, 32, 23, 32]);
    expect(x.verdict).toBe("model");
  });
});
