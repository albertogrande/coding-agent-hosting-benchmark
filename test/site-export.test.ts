import { describe, expect, it } from "vitest";
import s0File from "../data/published/hosting-s0-wave3.json";
import s1File from "../data/published/hosting-s1-opus55.json";
import type { PublishedDataset } from "@/derive/load-dataset";
import { DETAIL_CUT, readFlag, siteDataset } from "@/derive/site-export";

const d0 = s0File as unknown as PublishedDataset;
const d1 = s1File as unknown as PublishedDataset;
const site = siteDataset([d0, d1], "https://example.test/");

describe("the case study's runs.json", () => {
  it("carries every run of both seasons, once, in run order", () => {
    expect(site.count).toBe(264);
    const ids = site.runs.map((r) => r.run);
    expect(ids).toEqual([...new Set(ids)].sort((a, b) => a - b));
  });

  // The page must count what the record counts: the drift this replaced had Railway named
  // in 23 runs on the page and 39 in the repository.
  it("copies every label, mode and name from the published record", () => {
    const pub = new Map([...d0.runs, ...d1.runs].map((r) => [r.runId, r]));
    for (const r of site.runs) {
      const p = pub.get(r.run)!;
      expect([r.picked, r.decided, r.named, r.calls.length], `run ${r.run}`)
        .toEqual([p.adopted ?? null, p.decisionMode, p.platformsNamed, (p.toolTimeline as unknown[]).length]);
    }
  });

  it("names platforms as the grader does, outside the open brief", () => {
    const named = (model: string, platform: string) =>
      site.runs.filter((r) => r.model === model && r.brief !== "open" && r.named.includes(platform)).length;
    expect([named("Opus 5.5", "Railway"), named("Opus 5.5", "Cloudflare")]).toEqual([23, 14]);
  });

  it("cuts each call's detail and flags what it read", () => {
    expect(Math.max(...site.runs.flatMap((r) => r.calls.map((c) => c[1].length)))).toBeLessThanOrEqual(DETAIL_CUT);
    expect(readFlag({ tool: "WebFetch", detail: "https://render.com/pricing" })).toBe("web");
    expect(readFlag({ tool: "Bash", detail: "curl -s https://render.com/docs/blueprint-spec" })).toBe("docs");
    expect(readFlag({ tool: "Bash", detail: "curl -s https://example.org/guide" })).toBe("lookup");
    expect(readFlag({ tool: "Bash", detail: "curl -s -o /dev/null https://registry.npmjs.org/" })).toBe("net");
    expect(readFlag({ tool: "Bash", detail: "npm test" })).toBe("");
  });
});
