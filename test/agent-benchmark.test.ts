import { describe, expect, it } from "vitest";
import {
  adoptionIntervals, adoptionStability, agentBenchmark, frameAdoptionIntervals, NO_PLATFORM, platformOfHost,
} from "@/derive/agent-benchmark";
import { renderAgentReport, wrapDocument } from "@/lib/render-agent-report";
import { pilot, platforms, row } from "./fixtures/agent-rows";

describe("agentBenchmark", () => {
  it("refuses chat rows: an agent report reads what was written into a repository", () => {
    expect(() => agentBenchmark([row({ surfaceKey: "chat.api.anthropic" })], platforms)).toThrow(/chat surface/);
  });

  it("refuses to pool two agent surfaces", () => {
    expect(() => agentBenchmark([row(), row({ surfaceKey: "agent.repo.codex" })], platforms)).toThrow(/One agent per report/);
  });

  it("counts adoption over gradeable runs only, and shows the undecided", () => {
    const b = agentBenchmark(pilot(), platforms);
    expect(b.runs).toBe(8);
    expect(b.gradeable).toBe(7);
    expect(b.voided).toBe(1);
    expect(b.undecided).toBe(1);
    const render = b.adoption.find((a) => a.platform === "Render")!;
    expect(render.adopted).toBe(3);
    expect(render.share).toBeCloseTo(3 / 7);
    // Named without adopting still counts as presence: three adoptions, the Fly.io flip
    // that weighed Render, and the undecided run that named it.
    expect(render.named).toBe(5);
  });

  it("keeps a platform outside the catalogue under the agent's own name, flagged unlisted", () => {
    const b = agentBenchmark(pilot(), platforms);
    const pa = b.adoption.find((a) => a.platform === "PythonAnywhere")!;
    expect(pa).toBeDefined();
    expect(pa.listed).toBe(false);
    expect(pa.adopted).toBe(1);
    expect(b.needsReview).toBe(2);
  });

  it("cuts by repository and frame, in plan order, and marks unanimous cells", () => {
    const b = agentBenchmark(pilot(), platforms);
    expect(b.repositories).toEqual(["whoami", "healthchecks"]);
    expect(b.frames).toEqual(["cost", "open"]);
    const whoami = b.byRepository[0];
    expect(whoami.adopted[0]).toEqual({ platform: "Render", n: 3 });
    expect(whoami.frames[0].unanimous).toBe(true);
    expect(whoami.frames[1].unanimous).toBe(false);
    const hc = b.byRepository[1];
    expect(hc.gradeable).toBe(3);
    // A voided repeat is shown as voided, never as "no platform".
    expect(hc.frames[0].reps[1]).toMatchObject({ voided: true, adopted: null });
    expect(hc.frames[0].unanimous).toBe(false);
  });

  it("takes the plan's order and shows what the plan still owes, mid-wave", () => {
    const b = agentBenchmark(pilot(), platforms, {
      plan: { repositories: ["whoami", "healthchecks", "linkding"], frames: ["least-effort", "cost", "production", "open"], reps: 3 },
    });
    expect(b.repositories).toEqual(["whoami", "healthchecks", "linkding"]);
    expect(b.frames).toEqual(["least-effort", "cost", "production", "open"]);
    expect(b.reps).toBe(3);
    const linkding = b.byRepository[2];
    expect(linkding.owed).toBe(true);
    expect(linkding.runs).toBe(0);
    expect(linkding.frames.every((f) => f.reps.length === 0)).toBe(true);
    // A frame the plan names and nothing has run on is present, with nothing in it.
    expect(b.byFrame.find((f) => f.frame === "production")).toMatchObject({ gradeable: 0, adopted: [], promptText: "" });
    // A planned repository with no runs draws no interval on its own; the two with runs do.
    expect(b.adoption.find((a) => a.platform === "Render")!.ci).toBeDefined();
  });

  it("measures the flip rate on the platform adopted, over cells with 2+ gradeable repeats", () => {
    const s = adoptionStability(pilot());
    // Cell 3 has one gradeable repeat, so it cannot flip; cells 1, 2, 4 are comparable.
    expect(s.comparable).toBe(3);
    expect(s.flipped).toBe(2);
    expect(s.flipRate).toBeCloseTo(2 / 3);
    expect(s.examples[0]).toMatchObject({ cellId: 2, adopted: ["Render", "Fly.io"] });
  });

  it("reads decision modes and the hosts the agent opened", () => {
    const b = agentBenchmark(pilot(), platforms);
    expect(b.decisionModes.map((m) => [m.mode, m.runs])).toEqual([["prior", 5], ["search", 1], ["fetch", 1]]);
    expect(b.searched).toBe(1);
    expect(b.fetched).toBe(1);
    expect(b.pagesOpened).toBe(2);
    expect(b.hosts.map((h) => [h.host, h.owner])).toEqual([["docs.railway.com", "Railway"], ["render.com", "Render"]]);
  });

  it("records provenance: model served, drift, CLI release, account, durations", () => {
    const rows = pilot();
    rows[1].modelResolved = "claude-sonnet-5";
    const b = agentBenchmark(rows, platforms);
    expect(b.provenance.modelRequested).toBe("claude-opus-5");
    expect(b.provenance.drift).toBe(1);
    expect(b.provenance.modelsServed[0]).toEqual({ model: "claude-opus-5", runs: 7 });
    expect(b.provenance.cliVersions).toEqual(["2.1.260"]);
    expect(b.provenance.clean).toBe(true);
    expect(b.provenance.durationMedianMs).toBe(120_000);
  });

  it("names the sandbox image by tag and short digest, once per distinct image, and none on the host", () => {
    expect(agentBenchmark(pilot(), platforms).provenance.images).toEqual(["aeo-sandbox:s0@2a368b0692e4"]);
    const rows = pilot();
    rows[2].sandbox = { image: "aeo-sandbox:s0", digest: "sha256:ffffffffffff0000", cliVersion: "2.1.260" };
    expect(agentBenchmark(rows, platforms).provenance.images).toEqual(["aeo-sandbox:s0@2a368b0692e4", "aeo-sandbox:s0@ffffffffffff"]);
    expect(agentBenchmark(rows.map((r) => ({ ...r, sandbox: null })), platforms).provenance.images).toEqual([]);
  });

  it("keeps the full digest beside the stamp, and records who was relabelled and when", () => {
    const rows = pilot();
    rows[0].reviewedAt = 1_788_600_000;
    rows[3].reviewedAt = 1_788_700_000;
    const p = agentBenchmark(rows, platforms).provenance;
    expect(p.sandboxes).toEqual([{ image: "aeo-sandbox:s0", digest: "sha256:2a368b0692e48f3b9a6adfd8bbfe1b2861d873ccb989b32f97ec99a3466896b4" }]);
    expect(p.reviewed).toBe(2);
    expect(p.lastReviewedAt).toBe(1_788_700_000);
    const bare = agentBenchmark(pilot(), platforms).provenance;
    expect(bare.reviewed).toBe(0);
    expect(bare.lastReviewedAt).toBeNull();
  });

  it("an unclean run anywhere makes the provenance unclean", () => {
    const rows = pilot();
    rows[0].envClean = false;
    expect(agentBenchmark(rows, platforms).provenance.clean).toBe(false);
  });
});

describe("adoptionIntervals", () => {
  it("draws no interval with a single repository", () => {
    expect(adoptionIntervals(pilot().filter((r) => r.target === "whoami"), ["Render"]).size).toBe(0);
  });

  it("is deterministic and brackets the point estimate", () => {
    const a = adoptionIntervals(pilot(), ["Render"]);
    const b = adoptionIntervals(pilot(), ["Render"]);
    expect(a.get("Render")).toEqual(b.get("Render"));
    const ci = a.get("Render")!;
    expect(ci.lo).toBeLessThanOrEqual(3 / 7);
    expect(ci.hi).toBeGreaterThanOrEqual(3 / 7);
  });
});

describe("frameAdoptionIntervals", () => {
  it("is deterministic and brackets each frame's point estimate, no platform included", () => {
    const a = frameAdoptionIntervals(pilot(), ["Render", "Railway", "Fly.io"]);
    const b = frameAdoptionIntervals(pilot(), ["Render", "Railway", "Fly.io"]);
    expect([...a.keys()]).toEqual(["cost", "open"]);
    expect(a.get("cost")!.get("Render")).toEqual(b.get("cost")!.get("Render"));
    // cost: Render 2 of 3 gradeable; open: Render 1 of 4, nothing 1 of 4.
    const cost = a.get("cost")!.get("Render")!;
    expect(cost.lo).toBeLessThanOrEqual(2 / 3);
    expect(cost.hi).toBeGreaterThanOrEqual(2 / 3);
    const open = a.get("open")!;
    expect(open.get("Render")!.lo).toBeLessThanOrEqual(1 / 4);
    expect(open.get("Render")!.hi).toBeGreaterThanOrEqual(1 / 4);
    expect(open.get(NO_PLATFORM)!.lo).toBeLessThanOrEqual(1 / 4);
    expect(open.get(NO_PLATFORM)!.hi).toBeGreaterThanOrEqual(1 / 4);
    // A platform adopted nowhere in the frame has a bracket at zero, not a missing one.
    expect(a.get("cost")!.get("Fly.io")).toEqual({ lo: 0, hi: 0 });
  });

  it("draws no interval for a frame with a single repository, and one frame's bracket does not depend on another's", () => {
    const one = frameAdoptionIntervals(pilot().filter((r) => r.target === "whoami"), ["Render"]);
    expect(one.get("cost")!.size).toBe(0);
    const full = frameAdoptionIntervals(pilot(), ["Render"]);
    const costOnly = frameAdoptionIntervals(pilot().filter((r) => r.frame === "cost"), ["Render"]);
    expect(full.get("cost")!.get("Render")).toEqual(costOnly.get("cost")!.get("Render"));
  });

  it("lands on the frame cut, keyed by platform with the undecided share under NO_PLATFORM", () => {
    const b = agentBenchmark(pilot(), platforms);
    const open = b.byFrame.find((f) => f.frame === "open")!;
    expect(Object.keys(open.intervals)).toContain("Render");
    expect(Object.keys(open.intervals)).toContain(NO_PLATFORM);
    expect(open.intervals.Render).toEqual(frameAdoptionIntervals(pilot(), ["Render"]).get("open")!.get("Render"));
    // A planned frame nothing ran on has no interval.
    const planned = agentBenchmark(pilot(), platforms, { plan: { frames: ["cost", "open", "production"] } });
    expect(planned.byFrame.find((f) => f.frame === "production")!.intervals).toEqual({});
  });
});

describe("platformOfHost", () => {
  it("matches a declared domain and its subdomains, and nothing else", () => {
    expect(platformOfHost("docs.railway.com", platforms)).toBe("Railway");
    expect(platformOfHost("www.render.com", platforms)).toBe("Render");
    expect(platformOfHost("notrender.com", platforms)).toBeNull();
    expect(platformOfHost(null, platforms)).toBeNull();
  });
});

describe("renderAgentReport", () => {
  const meta = {
    title: "Where Claude Code deploys", question: "which platform?", eyebrow: "Hosting · pilot",
    waveId: 3, waveName: "pilot", waveFile: "waves/hosting-s0.json", promptSetName: "hosting-s0",
    toolRepo: "https://github.com/x/aeo-tool", datasetFile: "data/published/hosting-s0.json", graderVersion: "stance-3",
    briefs: [], caveats: ["one agent"],
    claims: [{ id: "adopted-Render", label: "Render: adopted", value: 43, derivation: "3 of 7", support: 3 }],
    generatedAt: new Date("2026-09-04T12:00:00Z"),
  };

  it("puts every run in the HTML, with its files, its trail and its closing message", () => {
    const rows = pilot();
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta);
    for (const r of rows) expect(html).toContain(`id="run-${r.runId}"`);
    expect(html).toContain("fly.toml");
    expect(html).toContain("fly.io free tier");
    expect(html).toContain("https://docs.railway.com/guides/django");
    expect(html).toContain("I went with Render.");
    // The empty states name their reason.
    expect(html).toContain("It searched the web zero times.");
    expect(html).toContain("voided rather than graded");
  });

  it("carries a dated changelog and a disclosure line above the fold when the publisher gives them", () => {
    const rows = pilot();
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, {
      ...meta,
      changelog: ["2026-09-07 · 32 flagged runs relabelled by hand; Fly.io 39% → 39%", "2026-09-06 · full season, 132 runs"],
      disclosure: "Run on the author's own subscription. No platform funded or saw this <before> publication.",
    });
    const fold = html.indexOf('<section class="findings"');
    expect(html.indexOf("What changed")).toBeGreaterThan(-1);
    expect(html.indexOf("What changed")).toBeLessThan(fold);
    expect(html).toContain("32 flagged runs relabelled by hand");
    expect(html).toContain("saw this &lt;before&gt; publication");
    expect(html.indexOf("saw this &lt;before&gt;")).toBeLessThan(fold);
    // Absent, nothing is rendered — not an empty box.
    const bare = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta);
    expect(bare).not.toContain("What changed");
    expect(bare).not.toContain('class="disclosure"');
  });

  it("escapes what the agent wrote and embeds no dataset: the file is the record, the page links it", () => {
    const rows = [row({ text: "<script>alert(1)</script> chose Render", searchQueries: ["</script><b>x</b>"] })];
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain('id="dataset"');
    expect(html).not.toContain('type="application/json"');
    expect(html).toContain('href="data/published/hosting-s0.json"');
    const linked = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, { ...meta, datasetUrl: "https://x.test/hosting-s0.json" });
    expect(linked).toContain('href="https://x.test/hosting-s0.json"');
    expect(linked).toContain("curl -O https://x.test/hosting-s0.json");
  });

  it("shows the first 15 tool calls in full and counts the rest, keeping the closing message whole", () => {
    const timeline = Array.from({ length: 40 }, (_, i) => ({ seq: i + 1, tool: "Bash", detail: `step-${i + 1}` }));
    const long = "The decision, in full. ".repeat(200);
    const rows = [row({ toolTimeline: timeline, text: long })];
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta);
    expect(html).toContain("step-15");
    expect(html).not.toContain("step-16");
    expect(html).toContain("and 25 more tool calls");
    expect(html).toContain(long);
    // A detail is its first line, capped: a heredoc body is not what the call was.
    const heredoc = [row({ toolTimeline: [{ seq: 1, tool: "Bash", detail: `cat > x.ts <<'EOF'\n${"body ".repeat(100)}\nEOF` }, { seq: 2, tool: "Bash", detail: "x".repeat(200) }] })];
    const h2 = renderAgentReport(agentBenchmark(heredoc, platforms), heredoc, platforms, meta);
    expect(h2).toContain("cat &gt; x.ts &lt;&lt;&#39;EOF&#39;…".replace(/&#39;/g, "'"));
    expect(h2).not.toContain("body body");
    expect(h2).toContain(`${"x".repeat(120)}…`);
    expect(h2).not.toContain("x".repeat(121));
  });

  it("draws the frame × platform chart as inline SVG with a bracket per bar and the reading rule once above it", () => {
    const rows = pilot();
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta);
    const svg = html.slice(html.indexOf('<svg class="fx"'), html.indexOf("</svg>"));
    expect(svg).toContain('class="fx-head" x="190" y="16">cost<');
    expect(svg).toContain(">open<");
    expect(svg).toContain("Render");
    expect(svg).toContain("no platform");
    // A bar and an interval per cell that has one; no library, no colour outside the page's variables.
    expect(svg).toContain('class="fx-bar"');
    expect(svg).toContain('class="fx-ci"');
    expect(svg).not.toMatch(/fill="#|stroke="#/);
    expect(html).not.toContain("<script src=");
    // Railway was adopted once, so it has a row; Fly.io too. A platform never adopted has none.
    expect(svg).toContain("Railway");
    expect(html.indexOf("Reading rule")).toBeLessThan(html.indexOf('<svg class="fx"'));
    expect(html.split("Reading rule").length).toBe(2);
  });

  it("puts the snapshot above the fold: dates, image, CLI, model, grader, review", () => {
    const rows = pilot();
    rows[0].reviewedAt = 1_788_600_000;
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta);
    const snap = html.slice(html.indexOf('<dl class="snapshot"'), html.indexOf("</dl>"));
    expect(html.indexOf('<dl class="snapshot"')).toBeLessThan(html.indexOf('<section class="findings"'));
    expect(snap).toContain("2026-09-04");
    expect(snap).toContain("aeo-sandbox:s0@2a368b0692e4");
    expect(snap).toContain("2.1.260");
    expect(snap).toContain("claude-opus-5</code> asked for");
    expect(snap).toContain("stance-3");
    expect(snap).toContain("2026-09-05 · 1 run relabelled by a person");
  });

  it("renders one card per platform brief with the frames it wins and loses and the quotes, linked to their runs", () => {
    const rows = pilot();
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, {
      ...meta,
      briefs: [{
        platform: "Render", named: 5, adopted: 3, share: 3 / 7, presence: 5 / 7,
        byFrame: [], lostTo: 1,
        winsMost: { frame: "cost", gradeable: 3, adopted: 2, named: 2, share: 2 / 3 },
        losesMost: { frame: "open", gradeable: 4, adopted: 1, named: 3, share: 1 / 4 },
        quotes: [{ runId: rows[3].runId, target: "whoami", frame: "open", adopted: "Fly.io", sentence: "Render is fine but Fly.io has a free tier." }],
      }],
    });
    const card = html.slice(html.indexOf('id="brief-render"'), html.indexOf("</article>"));
    expect(card).toContain("Wins most under <strong>cost</strong>: 2 of 3 (67%)");
    expect(card).toContain("Loses most under <strong>open</strong>: 1 of 4 (25%)");
    expect(card).toContain("Render is fine but Fly.io has a free tier.");
    expect(card).toContain(`href="#run-${rows[3].runId}"`);
    expect(card).toContain("chose Fly.io");
  });

  it("renders the replication card with the rate, every disagreement with both values, and the none-by-frame line", () => {
    const rows = pilot();
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, {
      ...meta,
      replication: {
        against: { waveId: 2, waveName: "full", note: "Wave 2 ran the same design on the host." },
        agreement: {
          comparable: 3, agreeing: 2, rate: 2 / 3,
          disagreements: [{ target: "healthchecks", frame: "cost", a: "Railway", b: "none" }],
          noMajority: [{ target: "whoami", frame: "open", a: null, b: "Render" }],
          unmatched: 0,
          noneByFrame: [{ frame: "cost", a: 0, b: 1 }, { frame: "open", a: 1, b: 0 }],
        },
      },
    });
    const card = html.slice(html.indexOf('id="replication"'), html.indexOf("</section>", html.indexOf('id="replication"')));
    expect(card).toContain("Replication against wave 2");
    expect(card).toContain("Wave 2 ran the same design on the host.");
    expect(card).toContain("(2 of 3)");
    expect(card).toContain("healthchecks");
    expect(card).toContain(">Railway<");
    expect(card).toContain("no platform");
    expect(card).toContain("whoami × open (no majority / Render)");
    expect(card).toContain("<strong>cost</strong> 0 vs 1 · <strong>open</strong> 1 vs 0");
    // Absent, no card.
    expect(renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta)).not.toContain('id="replication"');
  });

  it("states both reproduction paths honestly: the dataset file for re-grading, the image and token for re-running, no public-repo claim", () => {
    const rows = pilot();
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta);
    const card = html.slice(html.indexOf('id="reproduce"'), html.indexOf('id="claims"'));
    expect(card).toContain("Re-grade: minutes, no login");
    expect(card).toContain("Re-run: about a day on a Max subscription");
    expect(card).toContain("npm run grade -- 3");
    expect(card).toContain("aeo-sandbox:s0@sha256:2a368b0692e48f3b9a6adfd8bbfe1b2861d873ccb989b32f97ec99a3466896b4");
    expect(card).toContain("claude setup-token");
    expect(card).toContain("~/.config/aeo/claude-oauth-token");
    expect(card).toContain("npm run plan -- waves/hosting-s0.json");
    expect(card).toContain("npm run preflight -- hosting --wave N --benchmark");
    expect(card).toContain("npm run run-wave -- --wave N");
    expect(card).toContain("waits out usage windows");
    expect(card).toContain("private while the season is under review");
    expect(card).not.toMatch(/are public|is public/);
  });

  it("states the flip rate and the interval, and lists every claim", () => {
    const rows = pilot();
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta);
    expect(html).toContain("changed their mind between repeats (2 of 3)");
    expect(html).toContain("Render: adopted");
    expect(html).toContain("unlisted");
  });

  it("lays the page out as three tabs over three panels, each section in its panel, stacked without JavaScript", () => {
    const rows = pilot();
    const html = renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, { ...meta, caveats: ["one agent"] });
    const tabs = html.slice(html.indexOf('role="tablist"'), html.indexOf("</div>", html.indexOf('role="tablist"')));
    for (const id of ["results", "explore", "method"]) expect(tabs).toContain(`role="tab" id="tab-${id}" aria-controls="${id}"`);
    expect(tabs.split('role="tab"').length).toBe(4);
    const panel = (id: string) => {
      const open = html.indexOf(`role="tabpanel" id="${id}"`);
      expect(open).toBeGreaterThan(-1);
      const next = html.indexOf('role="tabpanel"', open + 1);
      return html.slice(open, next < 0 ? html.indexOf("<footer>") : next);
    };
    const results = panel("results"), explore = panel("explore"), method = panel("method");
    // Nothing is hidden server-side: without the script the panels stack.
    expect(html).not.toMatch(/role="tabpanel"[^>]*hidden/);
    // Results, in reading order: tiles, the rule once, the headline chart, then the rest.
    const order = ['<section class="findings"', 'class="rule"', 'id="by-frame"', 'id="adoption"', 'id="for-a-platform"', 'id="by-repository"', 'id="decision"'];
    const at = order.map((m) => results.indexOf(m));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(explore).toContain('id="runs"');
    expect(explore).toContain('id="filters"');
    for (const r of rows) expect(explore).toContain(`id="run-${r.runId}"`);
    for (const id of ["how-measured", "caveats", "reproduce", "claims"]) expect(method).toContain(`id="${id}"`);
    for (const id of ["runs", "how-measured", "caveats", "reproduce", "claims"]) expect(results).not.toContain(`id="${id}"`);
    // The header stays above the tabs.
    expect(html.indexOf('<dl class="snapshot"')).toBeLessThan(html.indexOf('role="tablist"'));
    // A chip in the repository grid still points at its run, which lives in another panel; the
    // script resolves the hash to the panel that holds it.
    const chips = results.match(/href="#run-\d+" class="chiplink"/g) ?? [];
    expect(chips.length).toBe(rows.length);
    expect(html).toContain("panels[i].contains(el)");
    expect(html).toContain('window.addEventListener("hashchange", fromHash)');
  });

  it("wraps into a complete document with the style in the head and the page in the body", () => {
    const rows = pilot();
    const doc = wrapDocument(renderAgentReport(agentBenchmark(rows, platforms), rows, platforms, meta));
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc.indexOf("<style>")).toBeLessThan(doc.indexOf("<body>"));
    expect(doc.indexOf("<main>")).toBeGreaterThan(doc.indexOf("<body>"));
    expect(doc).toContain("</html>");
  });
});
