import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import w2 from "../data/published/hosting-s0-full.json";
import w3 from "../data/published/hosting-s0-wave3.json";
import w5 from "../data/published/hosting-s1-opus55.json";
import w6 from "../data/published/hosting-s1-control-opus5.json";
import w7 from "../data/published/hosting-s1-night2-opus55.json";
import domainsFile from "../data/platform-domains.json";
import type { PublishedDataset } from "@/derive/load-dataset";
import { siteDataset } from "@/derive/site-export";
import { fig6Rows, writeupFigures } from "@/derive/writeup-figures";

// Every figure "Memory first, docs second" prints, as `npm run figures` computes it from the
// published files. A change here changes a published number: argue it in the write-up first.
const [s0Mac, s0, s1, control, s1Night2] = [w2, w3, w5, w6, w7] as unknown as PublishedDataset[];
const { runs } = siteDataset([s0, s1], "https://thebeat.dev/research/memory-first-docs-second/");
const f = writeupFigures(runs, domainsFile.domains, {
  s0: fig6Rows(s0),
  s0Mac: fig6Rows(s0Mac),
  s1: fig6Rows(s1),
  s1Night2: fig6Rows(s1Night2),
  control: fig6Rows(control),
});
const n = (x: { n: number; of: number }) => `${x.n}/${x.of}`;

describe("the write-up's figures reproduce from the published files", () => {
  it("rebuilds the runs.json the page serves, byte for byte", () => {
    // sha256 of thebeat.dev/research/memory-first-docs-second/runs.json, as served.
    const body = JSON.stringify(siteDataset([s0, s1], "https://thebeat.dev/research/memory-first-docs-second/"));
    expect(crypto.createHash("sha256").update(body).digest("hex")).toBe("d8761b10e30ebe4891a7e797e4ab6cf1b73cb0242e8d107983f10dd5f23a8fa7");
  });

  it("counts 264 runs of 11 apps", () => {
    expect([f.runs.n, f.apps]).toEqual([264, 11]);
  });

  it("section 3 and Fig. 1: decided from memory", () => {
    expect([n(f.memory.share["Opus 5"]), n(f.memory.share["Opus 5.5"])]).toEqual(["45/99", "51/99"]);
    expect([n(f.memory.webRuns), n(f.memory.memoryRunsLoaded), n(f.memory.newerListedStubs)]).toEqual(["83/83", "0/158", "19/51"]);
    expect(f.grid.map((g) => [g.brief, n(g.fromMemory["Opus 5"]), n(g.fromMemory["Opus 5.5"])])).toEqual([
      ["least-effort", "22/33", "24/33"],
      ["production", "16/33", "18/33"],
      ["cost", "7/33", "9/33"],
      ["open", "30/33", "32/33"],
    ]);
  });

  it("section 4 and Fig. 2: what the agent read, and when", () => {
    expect(f.grid.map((g) => [g.lookedUp["Opus 5"].pct, g.lookedUp["Opus 5.5"].pct])).toEqual([[33, 27], [52, 45], [79, 73], [9, 3]]);
    const d = f.docs;
    expect({
      own: n(d.ownPlatformRead),
      other: n(d.otherPlatformReads),
      straight: n(d.straightToPick),
      first: n(d.firstReadPicked),
      only: n(d.onlyReadPicked),
      before: n(d.readBefore),
      after: n(d.readAfter),
      unknown: n(d.readUnknown),
      costOlder: n(d.comparedCost["Opus 5"]),
      costNewer: n(d.comparedCost["Opus 5.5"]),
      elsewhere: n(d.comparedElsewhereNewer),
      cheapest: n(d.otherReadsCheapest),
      price: n(d.otherReadsAboutPrice),
    }).toEqual({
      own: "38/45",
      other: "38/216",
      straight: "31/38",
      first: "34/38",
      only: "26/38",
      before: "35/48",
      after: "3/48",
      unknown: "10/48",
      costOlder: "3/33",
      costNewer: "12/33",
      elsewhere: "0/99",
      cheapest: "38/38",
      price: "38/38",
    });
  });

  it("Fig. 4: named against picked", () => {
    expect(f.namedPicked.map(({ platform, byModel: b }) => [platform, b["Opus 5"].named.pct, b["Opus 5"].picked.pct, b["Opus 5.5"].named.pct, b["Opus 5.5"].picked.pct])).toEqual([
      ["Render", 79, 32, 66, 45],
      ["Fly.io", 72, 35, 61, 26],
      ["Vercel", 42, 3, 25, 3],
      ["Railway", 37, 3, 23, 0],
      ["Google Cloud Run", 31, 2, 15, 1],
      ["Cloudflare", 20, 7, 14, 3],
    ]);
  });

  it("Fig. 5 and section 6: the winners, and the apps whose host moved with the job", () => {
    expect(f.winners.map(({ byModel: b }) => ["Opus 5", "Opus 5.5"].map((m) => `${b[m].top} ${b[m].topShare.pct} / ${b[m].next} ${b[m].nextShare.pct}`))).toEqual([
      ["Render 52 / Fly.io 18", "Render 73 / Netlify 12"],
      ["Fly.io 61 / Render 24", "Fly.io 55 / Render 33"],
      ["Fly.io 27 / Render 21", "Render 30 / Fly.io 24"],
      ["No outside host 82 / Fly.io 12", "No outside host 58 / Fly.io 21"],
    ]);
    expect([f.differ["Opus 5"], f.differ["Opus 5.5"]]).toEqual([6, 8]);
  });

  it("Fig. 6: the floors, the update, its repeat and the control", () => {
    const mu = f.modelUpdate;
    expect([mu.floorNewer, mu.floorOlder, mu.update, mu.updateAgain].map((r) => [n(r), r.lo, r.hi])).toEqual([
      ["28/32", 77, 97],
      ["27/31", 77, 97],
      ["20/31", 48, 80],
      ["21/32", 43, 85],
    ]);
    expect(mu.control).toEqual({ changed: 11, likeOlder: 8, likeNewer: 3, likeNeither: 0 });
  });
});
