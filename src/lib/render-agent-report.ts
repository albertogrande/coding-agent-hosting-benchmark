/**
 * Renders an agent-arm report as one self-contained HTML page.
 *
 * Formats only. Every figure arrives already derived from `src/derive/agent-benchmark.ts`;
 * this file must never compute one, or the page and the store could disagree and nothing
 * would catch it. The only arithmetic here is turning a fraction into a percent string.
 *
 * Shape, borrowed from what worked in the AEO evidence explorer and what its handoff called
 * a mistake:
 *   - every run is in the HTML, with its prompt, its verdict, the files it wrote, the pages
 *     it opened and its closing text. The page reads with JavaScript disabled; filtering is
 *     an enhancement, and every field a filter offers is also a column.
 *   - an empty state names its reason ("searched twice, opened nothing") instead of
 *     showing nothing.
 *   - one hue for magnitude. Platform identity is carried by the name, never by a colour
 *     the reader would have to memorise.
 *   - the last section lists every number on the page with how it was computed.
 */
import { NO_PLATFORM, type AgentBenchmark, type AgentRow, type FrameCut, type PlatformAdoption, type RepositoryCut } from "@/derive/agent-benchmark";
import type { Claim } from "@/derive/claims";
import type { PlatformBrief } from "@/derive/platform-brief";
import type { CellAgreement } from "@/derive/replication";

export type ReportMeta = {
  title: string;
  /** The question, in one sentence, under the title. */
  question: string;
  /** Eyebrow above the title: "Hosting platforms · season 0 pilot". */
  eyebrow: string;
  waveId: number;
  waveName: string;
  /** The wave file and prompt set a reader would re-plan from. */
  waveFile: string;
  promptSetName: string;
  /** Repository of the tool, for the reproduce section. Private while the season is under review. */
  toolRepo: string;
  /** The published dataset: where it is committed, and where a reader can fetch it if that is elsewhere. */
  datasetFile: string;
  datasetUrl?: string;
  /** The grader whose labels the page carries. */
  graderVersion: string;
  /** One card per catalogue platform: named against adopted, and what the agent said when it lost. */
  briefs: PlatformBrief[];
  /** The replication check against another wave of the same design, when one was given. */
  replication?: {
    against: { waveId: number; waveName: string; note: string };
    agreement: CellAgreement;
  };
  /** Stated limitations, rendered prominently. */
  caveats: string[];
  /**
   * What changed since the page was last published, newest first, each entry starting with
   * its date. A reader who saw the page last week should learn here whether the headline moved.
   */
  changelog?: string[];
  /** Who ran this, on whose money, and any interest in the result. One sentence, above the fold. */
  disclosure?: string;
  /** Every figure on the page, with its derivation, verified before rendering. */
  claims: Claim[];
  generatedAt: Date;
};

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pct = (n: number) => `${Math.round(n * 100)}%`;
const n = (x: number) => x.toLocaleString("en-GB");
const date = (unix: number | null) => (unix === null ? "—" : new Date(unix * 1000).toISOString().slice(0, 10));
const dur = (ms: number | null) => {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;

/** Tool calls shown per run. The rest are counted; the stored run holds them all. */
export const TIMELINE_SHOWN = 15;
/**
 * Characters of a tool call's detail shown, first line only. A Bash detail can carry a whole
 * heredoc; the page shows what the call was, the stored run holds what it wrote.
 */
export const DETAIL_SHOWN = 120;
/** Characters of a run's tool-error text shown. The count is exact; the text is a sample. */
export const ERRORS_SHOWN = 240;
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);
const brief = (detail: string): string => {
  const line = detail.split("\n")[0];
  const cut = line.length > DETAIL_SHOWN || line.length < detail.length;
  return cut ? `${line.slice(0, DETAIL_SHOWN).trimEnd()}…` : line;
};

const TIER: Record<string, string> = {
  "config-file": "a config file it wrote",
  "deploy-artifact": "a deploy command it wrote",
  "final-message": "its closing message",
  unlisted: "its closing message (a name outside the catalogue)",
  "needs-review": "nothing conclusive",
};

// ------------------------------------------------------------------ pieces

function chip(adopted: string | null, opts: { voided?: boolean; ungraded?: boolean; listed?: (p: string) => boolean } = {}): string {
  if (opts.ungraded) return `<span class="chip chip-void" title="stored, not graded yet">not graded yet</span>`;
  if (opts.voided) return `<span class="chip chip-void" title="did not finish — not graded">voided</span>`;
  if (!adopted) return `<span class="chip chip-none">no platform</span>`;
  const unlisted = opts.listed && !opts.listed(adopted);
  return `<span class="chip${unlisted ? " chip-unlisted" : ""}"${unlisted ? ' title="outside the catalogue — recorded under the name the agent used"' : ""}>${esc(adopted)}</span>`;
}

function adoptionChart(b: AgentBenchmark): string {
  const scores = b.adoption.filter((s) => s.adopted > 0 || s.named > 0);
  if (!scores.length) return `<p class="empty">No gradeable run has committed to a platform yet.</p>`;
  const max = Math.max(...scores.map((s) => s.ci?.hi ?? s.share), 0.0001);
  const x = (v: number) => `${(v / max) * 100}%`;
  return `<div class="chart">${scores.map((s) => `
      <div class="row">
        <div class="name">${esc(s.platform)}${s.listed ? "" : ' <span class="tag">unlisted</span>'}</div>
        <div class="plot" role="img" tabindex="0"
             aria-label="${esc(s.platform)}: adopted in ${pct(s.share)} of gradeable runs (${s.adopted} of ${b.gradeable})${
               s.ci ? `, 95% range ${pct(s.ci.lo)} to ${pct(s.ci.hi)}` : ""}; named in ${pct(s.presence)}"
             title="${esc(s.platform)} · adopted ${s.adopted} of ${b.gradeable}${s.ci ? ` · 95% ${pct(s.ci.lo)}–${pct(s.ci.hi)}` : ""} · named in ${s.named}">
          <div class="bar" style="width:${x(s.share)}"></div>
          ${s.ci ? `<div class="ci-band" style="left:${x(s.ci.lo)};width:${x(s.ci.hi - s.ci.lo)}"></div>` : ""}
        </div>
        <span class="val">${pct(s.share)}<span class="muted"> ${s.adopted}/${b.gradeable}</span></span>
      </div>`).join("")}
  </div>`;
}

function adoptionTable(b: AgentBenchmark): string {
  const rows = b.adoption.filter((s) => s.adopted > 0 || s.named > 0);
  const cell = (s: PlatformAdoption) => `
        <tr>
          <th scope="row">${esc(s.platform)}${s.listed ? "" : ' <span class="tag">unlisted</span>'}</th>
          <td class="num">${pct(s.share)} <span class="muted">${s.adopted}/${b.gradeable}</span></td>
          <td class="num muted">${s.ci ? `${pct(s.ci.lo)}–${pct(s.ci.hi)}` : "—"}</td>
          <td class="num">${pct(s.presence)} <span class="muted">${s.named}/${b.gradeable}</span></td>
        </tr>`;
  return `
    <table>
      <caption class="sr-only">Every figure behind the chart above</caption>
      <thead><tr>
        <th scope="col">Platform</th>
        <th scope="col" class="num">Adopted</th>
        <th scope="col" class="num">95% range</th>
        <th scope="col" class="num">Named at all</th>
      </tr></thead>
      <tbody>
        ${rows.map(cell).join("")}
        ${b.undecided ? `
        <tr class="dim">
          <th scope="row">No platform chosen</th>
          <td class="num">${pct(b.gradeable ? b.undecided / b.gradeable : 0)} <span class="muted">${b.undecided}/${b.gradeable}</span></td>
          <td class="num muted">—</td>
          <td class="num muted">—</td>
        </tr>` : ""}
      </tbody>
    </table>`;
}

function repositoryGrid(b: AgentBenchmark, listed: (p: string) => boolean): string {
  if (!b.byRepository.length) return `<p class="empty">Nothing has run yet.</p>`;
  const head = b.frames.map((f) => `<th scope="col">${esc(f)}</th>`).join("");
  const row = (r: RepositoryCut) => {
    const cells = b.frames.map((f) => {
      const c = r.frames.find((x) => x.frame === f);
      if (!c || !c.reps.length) return `<td class="muted owed" title="planned, not run yet">owed</td>`;
      return `<td class="cell${c.unanimous ? " unanimous" : ""}">
          ${c.reps.map((rep) => `<a href="#run-${rep.runId}" class="chiplink">${chip(rep.adopted, { voided: rep.voided, ungraded: rep.ungraded, listed })}</a>`).join("")}
          ${c.unanimous ? '<span class="tick" title="every repeat agreed">✓</span>' : ""}
        </td>`;
    }).join("");
    const top = r.adopted[0];
    return `
      <tr>
        <th scope="row">
          <span class="repo">${esc(r.target)}</span>
          ${r.repoUrl ? `<a class="sha" href="${esc(r.repoUrl)}${r.baseSha ? `/tree/${esc(r.baseSha)}` : ""}">${esc(r.baseSha ? r.baseSha.slice(0, 7) : "repo")}</a>` : ""}
        </th>
        ${cells}
        <td class="summary">
          ${top ? `${esc(top.platform)} <span class="muted">${top.n}/${r.gradeable}${r.undecided ? ` · ${r.undecided} none` : ""}</span>` : `<span class="muted">${r.gradeable ? "no platform" : "nothing gradeable"}</span>`}
        </td>
      </tr>`;
  };
  return `
    <div class="scroll">
    <table class="grid">
      <caption class="sr-only">What each repository's cells committed to, by frame and repeat</caption>
      <thead><tr><th scope="col">Repository</th>${head}<th scope="col">Most often</th></tr></thead>
      <tbody>${b.byRepository.map(row).join("")}</tbody>
    </table>
    </div>`;
}

const range = (ci: { lo: number; hi: number } | undefined) => (ci ? ` · ${pct(ci.lo)}–${pct(ci.hi)}` : "");

/**
 * Frame × platform, as one inline SVG: a row per platform that was adopted anywhere (plus
 * "no platform" as its own row), a column per frame, each bar the share of that frame's
 * gradeable runs, each bracket the 95% interval from resampling repositories. No library:
 * the page must read from a file with nothing else loaded, and the colours are the page's
 * own variables so it reads in both themes.
 */
function frameChart(b: AgentBenchmark): string {
  const frames = b.byFrame.filter((f) => f.gradeable > 0);
  if (!frames.length) return `<p class="empty">No frame has a gradeable run yet.</p>`;
  const series = [
    ...b.adoption.filter((a) => a.adopted > 0).map((a) => ({ key: a.platform, label: a.platform, none: false })),
    ...(b.undecided ? [{ key: NO_PLATFORM, label: "no platform", none: true }] : []),
  ];
  const count = (f: FrameCut, key: string) => (key === NO_PLATFORM ? f.undecided : (f.adopted.find((a) => a.platform === key)?.n ?? 0));
  const share = (f: FrameCut, key: string) => (f.gradeable ? count(f, key) / f.gradeable : 0);
  const max = Math.max(...frames.flatMap((f) => series.map((s) => f.intervals[s.key]?.hi ?? share(f, s.key))), 0.0001);

  const labelW = 190, colW = 176, valW = 40, gap = 16, rowH = 22, headH = 36, footH = 24;
  const plotW = colW - valW;
  const width = labelW + frames.length * (colW + gap) - gap;
  const height = headH + series.length * rowH + footH;
  const x = (v: number) => (v / max) * plotW;
  const col = (i: number) => labelW + i * (colW + gap);
  const plotTop = headH, plotBottom = headH + series.length * rowH;

  const columns = frames.map((f, i) => `
    <g class="fx-col">
      <text class="fx-head" x="${col(i)}" y="16">${esc(f.frame)}</text>
      <text class="fx-muted" x="${col(i)}" y="30">${f.gradeable} runs</text>
      <line class="fx-axis" x1="${col(i)}" x2="${col(i)}" y1="${plotTop}" y2="${plotBottom}"/>
      <line class="fx-grid" x1="${col(i) + plotW}" x2="${col(i) + plotW}" y1="${plotTop}" y2="${plotBottom}"/>
      <text class="fx-muted" x="${col(i)}" y="${plotBottom + 16}">0</text>
      <text class="fx-muted" x="${col(i) + plotW}" y="${plotBottom + 16}" text-anchor="end">${pct(max)}</text>
    </g>`).join("");

  const rows = series.map((s, j) => {
    const y = headH + j * rowH;
    const cells = frames.map((f, i) => {
      const nHere = count(f, s.key), sh = share(f, s.key), ci = f.intervals[s.key];
      const x0 = col(i), cy = y + rowH / 2;
      return `
      <g>
        <title>${esc(s.label)} · ${esc(f.frame)}: ${nHere} of ${f.gradeable} (${pct(sh)})${ci ? ` · 95% ${pct(ci.lo)}–${pct(ci.hi)}` : ""}</title>
        ${nHere ? `<rect class="fx-bar${s.none ? " none" : ""}" x="${x0}" y="${y + 5}" width="${x(sh).toFixed(1)}" height="${rowH - 10}"/>` : ""}
        ${ci && ci.hi > 0 ? `<line class="fx-ci" x1="${(x0 + x(ci.lo)).toFixed(1)}" x2="${(x0 + x(ci.hi)).toFixed(1)}" y1="${cy}" y2="${cy}"/>
        <line class="fx-ci" x1="${(x0 + x(ci.lo)).toFixed(1)}" x2="${(x0 + x(ci.lo)).toFixed(1)}" y1="${cy - 4}" y2="${cy + 4}"/>
        <line class="fx-ci" x1="${(x0 + x(ci.hi)).toFixed(1)}" x2="${(x0 + x(ci.hi)).toFixed(1)}" y1="${cy - 4}" y2="${cy + 4}"/>` : ""}
        <text class="fx-val" x="${x0 + plotW + 6}" y="${cy + 4}">${nHere || ""}</text>
      </g>`;
    }).join("");
    return `
    <g class="fx-row">
      <text class="fx-label${s.none ? " none" : ""}" x="${labelW - 12}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(s.label)}</text>
      <line class="fx-grid" x1="0" x2="${width}" y1="${y + rowH}" y2="${y + rowH}"/>
      ${cells}
    </g>`;
  }).join("");

  return `
    <div class="scroll">
    <svg class="fx" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
         aria-label="Share of each frame's gradeable runs committed to each platform, with a 95% interval from resampling repositories">
      <title>Frame × platform: share of gradeable runs adopted, with 95% intervals</title>
      ${columns}
      ${rows}
    </svg>
    </div>`;
}

function briefCards(briefs: PlatformBrief[], b: AgentBenchmark): string {
  if (!briefs.length) return `<p class="empty">No catalogue platform has been named or adopted yet.</p>`;
  const frameLine = (f: { frame: string; adopted: number; gradeable: number; named: number }) =>
    `<strong>${esc(f.frame)}</strong>: ${f.adopted} of ${f.gradeable} (${pct(f.gradeable ? f.adopted / f.gradeable : 0)}), named in ${f.named}`;
  return `<div class="briefs">${briefs.map((p) => `
    <article class="brief" id="brief-${esc(slug(p.platform))}">
      <h3>${esc(p.platform)}</h3>
      <p class="brief-k"><span class="k">${pct(p.share)}</span> adopted <span class="muted">${p.adopted} of ${b.gradeable}</span> · named in ${pct(p.presence)} <span class="muted">${p.named}</span></p>
      <ul>
        ${p.winsMost
          ? `<li>Wins most under ${frameLine(p.winsMost)}.</li>`
          : `<li>Adopted under no frame${p.named ? `; named in ${plural(p.named, "run")} and chosen in none` : ""}.</li>`}
        ${p.losesMost && (!p.winsMost || p.losesMost.frame !== p.winsMost.frame)
          ? `<li>Loses most under ${frameLine(p.losesMost)}.</li>`
          : p.losesMost ? `<li>Named under no other frame.</li>` : `<li>Never named in a closing message; the adoption was read from the tree.</li>`}
      </ul>
      ${p.quotes.length ? `
      <h5>What the agent said when it weighed ${esc(p.platform)} and chose another <span class="muted">· ${plural(p.lostTo, "run")}, ${p.quotes.length} quoted</span></h5>
      ${p.quotes.map((q) => `
      <blockquote>
        <p>${esc(q.sentence)}</p>
        <cite><a href="#run-${q.runId}">run ${q.runId}</a> · ${esc(q.target)} · ${esc(q.frame)} · chose ${esc(q.adopted)}</cite>
      </blockquote>`).join("")}` : p.lostTo
        ? `<p class="muted">${plural(p.lostTo, "run")} named it and chose another, and none of them said why in a sentence naming it.</p>`
        : `<p class="muted">No run named it and chose another.</p>`}
    </article>`).join("")}
  </div>`;
}

function replicationCard(b: AgentBenchmark, meta: ReportMeta): string {
  const r = meta.replication;
  if (!r) return "";
  const a = r.agreement;
  const here = `wave ${meta.waveId}`, there = `wave ${r.against.waveId}`;
  const value = (v: string) => (v === "none" ? '<span class="chip chip-none">no platform</span>' : `<span class="chip">${esc(v)}</span>`);
  return `
  <section class="card" id="replication">
    <h2>Replication against ${esc(there)}</h2>
    <p class="lede">${esc(r.against.note)} Each repository × frame cell is compared on its majority, the value two or
      more of its repeats held, with “no platform” a value of its own; a cell with no majority on either side is listed,
      not compared. This is the between-nights stability figure; the flip rate in the tiles is the within-night one.</p>
    ${a.comparable ? `
    <div class="findings">
      <div class="finding">
        <div class="k">${pct(a.rate ?? 0)}</div>
        <p>of ${plural(a.comparable, "comparable cell")} reached the same majority in both waves (${a.agreeing} of ${a.comparable}).</p>
      </div>
      <div class="finding">
        <div class="k">${a.disagreements.length}</div>
        <p>${a.disagreements.length === 1 ? "cell" : "cells"} whose majority moved between the waves, listed below with both values.</p>
      </div>
      <div class="finding">
        <div class="k">${a.noMajority.length}</div>
        <p>${a.noMajority.length === 1 ? "cell" : "cells"} not compared: no value held by two repeats on at least one side.${a.unmatched ? ` ${plural(a.unmatched, "cell")} ran in one wave only.` : ""}</p>
      </div>
    </div>
    ${a.disagreements.length ? `
    <div class="scroll">
    <table>
      <caption class="sr-only">Cells whose majority differs between the waves</caption>
      <thead><tr><th scope="col">Repository</th><th scope="col">Frame</th><th scope="col">${esc(here)}</th><th scope="col">${esc(there)}</th></tr></thead>
      <tbody>${a.disagreements.map((d) => `
        <tr><th scope="row">${esc(d.target)}</th><td>${esc(d.frame)}</td><td>${value(d.a)}</td><td>${value(d.b)}</td></tr>`).join("")}
      </tbody>
    </table>
    </div>` : `<p class="empty">Every comparable cell agreed.</p>`}
    ${a.noMajority.length ? `<p class="floor">Not compared: ${a.noMajority.map((c) => `${esc(c.target)} × ${esc(c.frame)} (${c.a ?? "no majority"} / ${c.b ?? "no majority"})`).join("; ")}.</p>` : ""}` : `<p class="empty">The two waves share no cell with a majority on both sides, so nothing can be compared.</p>`}
    <p class="floor">Runs that committed to no platform, by frame, ${esc(here)} against ${esc(there)}:
      ${a.noneByFrame.map((f) => `<strong>${esc(f.frame)}</strong> ${f.a} vs ${f.b}`).join(" · ")}.</p>
  </section>`;
}

/** The dated facts a reader checks first, above the fold: when, on what, served by what, graded and reviewed how. */
function snapshot(b: AgentBenchmark, meta: ReportMeta): string {
  const p = b.provenance;
  const served = p.modelsServed.length
    ? p.modelsServed.map((m) => `<code>${esc(m.model)}</code>${p.modelsServed.length > 1 || m.runs !== b.runs ? ` <span class="muted">${m.runs}/${b.runs}</span>` : ""}`).join(", ")
    : '<span class="muted">none yet</span>';
  return `
  <dl class="snapshot" aria-label="Snapshot">
    <div><dt>Ran</dt><dd>${date(p.firstRunAt)}${p.lastRunAt && p.lastRunAt !== p.firstRunAt ? ` to ${date(p.lastRunAt)}` : ""}</dd></div>
    <div><dt>Image</dt><dd>${p.images.length ? p.images.map((v) => `<code>${esc(v)}</code>`).join(", ") : '<span class="muted">none: ran on the host</span>'}</dd></div>
    <div><dt>CLI</dt><dd>${p.cliVersions.length ? p.cliVersions.map((v) => `<code>${esc(v)}</code>`).join(", ") : "—"}</dd></div>
    <div><dt>Model</dt><dd><code>${esc(p.modelRequested ?? "none")}</code> asked for · ${served} served${p.drift ? ` <span class="tag warn">${p.drift} drifted</span>` : ""}</dd></div>
    <div><dt>Grader</dt><dd><code>${esc(meta.graderVersion)}</code></dd></div>
    <div><dt>Reviewed</dt><dd>${p.lastReviewedAt ? `${date(p.lastReviewedAt)} · ${plural(p.reviewed, "run")} relabelled by a person` : "no run relabelled"}</dd></div>
  </dl>`;
}

function frameTable(b: AgentBenchmark): string {
  return `
    <table>
      <caption class="sr-only">What each frame produced, pooled across repositories</caption>
      <thead><tr><th scope="col">Frame</th><th scope="col">The prompt, verbatim</th><th scope="col">Adopted</th></tr></thead>
      <tbody>${b.byFrame.map((f) => `
        <tr>
          <th scope="row">${esc(f.frame)}</th>
          <td class="prompt">${f.promptText ? esc(f.promptText) : '<span class="muted">not run yet</span>'}</td>
          <td class="tally">${f.adopted.map((a) => `${esc(a.platform)} <span class="muted">${a.n}${range(f.intervals[a.platform])}</span>`).join(" · ")}${
            f.undecided ? `${f.adopted.length ? " · " : ""}none <span class="muted">${f.undecided}${range(f.intervals[NO_PLATFORM])}</span>` : ""}${
            !f.adopted.length && !f.undecided ? '<span class="muted">nothing gradeable</span>' : ""}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

function decisionSection(b: AgentBenchmark): string {
  const modes = b.decisionModes.length ? `
    <table>
      <caption class="sr-only">How the agent reached its decision</caption>
      <thead><tr><th scope="col">Decided from</th><th scope="col" class="num">Runs</th><th scope="col">Adopted</th></tr></thead>
      <tbody>${b.decisionModes.map((m) => `
        <tr>
          <th scope="row">${m.mode === "prior" ? "prior knowledge — no search, no page" : m.mode === "search" ? "a search — results read, no page opened" : m.mode === "fetch" ? "a page it opened" : "not recorded"}</th>
          <td class="num">${m.runs}</td>
          <td class="tally">${m.adopted.map((a) => `${esc(a.platform)} <span class="muted">${a.n}</span>`).join(" · ") || '<span class="muted">none</span>'}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<p class="empty">No gradeable run yet.</p>`;

  const hosts = b.hosts.length ? `
    <table>
      <caption class="sr-only">Hosts whose pages the agent opened</caption>
      <thead><tr><th scope="col">Host</th><th scope="col" class="num">Pages</th><th scope="col" class="num">Runs</th><th scope="col">Owned by</th></tr></thead>
      <tbody>${b.hosts.slice(0, 20).map((h) => `
        <tr><th scope="row">${esc(h.host)}</th><td class="num">${h.pages}</td><td class="num">${h.runs}</td><td>${h.owner ? esc(h.owner) : '<span class="muted">third party</span>'}</td></tr>`).join("")}
      </tbody>
    </table>` : `<p class="empty">${b.searched
      ? `${plural(b.searched, "run")} searched and none opened a page: the agent decided from result snippets, which is a decision and not a fault of the harness.`
      : "No run searched or opened a page: every decision came from prior knowledge."}</p>`;

  return `
    <p class="lede">${plural(b.searched, "run")} of ${b.gradeable} ran at least one web search and ${b.fetched} opened at least one page
      (${plural(b.pagesOpened, "page")} in all). “Prior” means the agent never left the repository.</p>
    <div class="two">
      <div class="scroll">${modes}</div>
      <div class="scroll">${hosts}</div>
    </div>`;
}

function runRow(r: AgentRow, listed: (p: string) => boolean): string {
  const gradeable = r.status !== "error" && !!r.reach && r.reach !== "voided";
  const fetched = r.sources.filter((s) => s.kind === "fetch");
  const web = r.status === "error" ? "—"
    : `${r.searchCount ?? 0} search${(r.searchCount ?? 0) === 1 ? "" : "es"} · ${fetched.length} page${fetched.length === 1 ? "" : "s"}`;
  const ungraded = r.status !== "error" && !r.reach;
  const verdict = r.status === "error"
    ? `<span class="chip chip-void">error</span>`
    : ungraded ? chip(null, { ungraded: true })
    : !gradeable ? chip(null, { voided: true })
    : chip(r.adopted, { listed });
  const tier = r.adoptionSource ? (TIER[r.adoptionSource] ?? r.adoptionSource) : (gradeable ? "—" : "—");
  const modeLabel = r.decisionMode ?? (gradeable ? "unknown" : "—");

  const evidence = r.adoptionEvidence.length
    ? `<ul class="ladder">${r.adoptionEvidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
    : `<p class="muted">${esc(r.evidence ?? "the ladder saw nothing — no config file, no deploy command, no decision sentence")}</p>`;

  const files = r.changedFiles.length
    ? `<ul class="files">${r.changedFiles.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul>`
    : `<p class="muted">${r.status === "error" ? "The run failed before it could write anything." : "It wrote nothing into the repository."}</p>`;

  const queries = r.searchQueries.length
    ? `<ul class="trail">${r.searchQueries.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`
    : `<p class="muted">It searched the web zero times.</p>`;
  const pages = fetched.length
    ? `<ul class="trail">${fetched.map((s) => `<li><a href="${esc(s.url)}">${esc(s.url)}</a></li>`).join("")}</ul>`
    : `<p class="muted">${(r.searchCount ?? 0) > 0
        ? `${plural(r.searchCount ?? 0, "search", "searches")} ran and it opened nothing: it decided from the result snippets.`
        : "It opened no page."}</p>`;

  const shown = r.toolTimeline.slice(0, TIMELINE_SHOWN);
  const rest = r.toolTimeline.length - shown.length;
  const timeline = r.toolTimeline.length
    ? `<ol class="timeline">${shown.map((t) => `<li><b>${esc(t.tool)}</b>${t.detail ? ` ${esc(brief(t.detail))}` : ""}</li>`).join("")}</ol>${
        rest ? `<p class="muted more">and ${plural(rest, "more tool call")}: the page shows the first ${TIMELINE_SHOWN}; the dataset file carries the count and the stored run the calls.</p>` : ""}`
    : `<p class="muted">No tool calls were recorded.</p>`;

  // The closing message is the one block whose whitespace is the agent's; everything else
  // in the row is template indentation, and 132 rows of it weigh a tenth of a megabyte.
  const answer = `<pre class="answer">${esc(r.text || "(empty)")}</pre>`;
  return `
      <tr class="run" id="run-${r.runId}"
          data-repo="${esc(r.target)}" data-frame="${esc(r.frame)}"
          data-adopted="${esc(r.status === "error" ? "(error)" : ungraded ? "(not graded)" : !gradeable ? "(voided)" : r.adopted ?? "(none)")}"
          data-review="${r.needsReview ? "1" : "0"}">
        <td><button class="toggle" type="button" aria-expanded="true" aria-controls="detail-${r.runId}">${esc(r.target)}</button></td>
        <td>${esc(r.frame)}</td>
        <td class="num">${r.rep}</td>
        <td>${verdict}${r.needsReview ? ' <span class="tag warn" title="the grader could not call this confidently">review</span>' : ""}${r.reviewNote ? ' <span class="tag" title="relabelled by a person">reviewed</span>' : ""}</td>
        <td class="muted">${esc(tier)}</td>
        <td class="muted">${esc(modeLabel)}</td>
        <td class="num">${r.changedFiles.length || (r.status === "error" ? "—" : "0")}</td>
        <td class="muted nowrap">${web}</td>
        <td class="num">${dur(r.durationMs)}</td>
      </tr>
      <tr class="detail" id="detail-${r.runId}">
        <td colspan="9">
          <div class="detail-grid">
            <div>
              <h4>Prompt <span class="muted">· ${esc(r.promptKey)}</span></h4>
              <p class="prompt">${esc(r.promptText)}</p>

              <h4>Verdict</h4>
              <p>${r.status === "error"
                ? `The run failed and measured nothing: <code>${esc(r.stopReason ?? "error")}</code>. Its cell stays owed.`
                : ungraded
                  ? "Stored and not yet graded at the current grader version. Nothing below has been read by the ladder."
                : !gradeable
                  ? `The run did not finish (<code>${esc(r.stopReason ?? "no reason recorded")}</code>), so it is voided rather than graded. Not evidence about any platform.`
                  : r.adopted
                    ? `Committed to <strong>${esc(r.adopted)}</strong>, read from ${esc(tier)}.${
                        (r.platformsNamed ?? []).filter((p) => p !== r.adopted).length
                          ? ` Also named: ${esc((r.platformsNamed ?? []).filter((p) => p !== r.adopted).join(", "))}.` : ""}`
                    : `Committed to nothing.${(r.platformsNamed ?? []).length ? ` Named ${esc((r.platformsNamed ?? []).join(", "))} without choosing.` : " Named no platform at all."}`}
              </p>
              ${r.adoptionConflict ? `<p class="conflict">The files and the prose disagreed: ${esc(r.adoptionConflict)}. The closing message wins; both are kept.</p>` : ""}
              <h5>What the ladder saw, top rung first</h5>
              ${evidence}
              ${r.reviewNote ? `<p class="reviewed">A person relabelled this: ${esc(r.reviewNote)}</p>` : ""}

              <h4>Files it created or changed <span class="muted">· ${r.changedFiles.length}</span></h4>
              ${files}

              <h4>Web trail</h4>
              <h5>Searches</h5>
              ${queries}
              <h5>Pages opened</h5>
              ${pages}

              <h4>Run</h4>
              <ul class="meta">
                <li>${esc(r.surfaceLabel)} · served by <code>${esc(r.modelResolved ?? "unknown")}</code>${r.modelRequested && r.modelResolved && r.modelRequested !== r.modelResolved ? ` <span class="tag warn">asked for ${esc(r.modelRequested)}</span>` : ""}${r.toolVersion ? ` · CLI ${esc(r.toolVersion)}` : ""}</li>
                <li>${dur(r.durationMs)} · ${plural(r.toolTimeline.length, "tool call")} · ${date(r.ranAt)}</li>
                <li>${r.repoUrl ? `<a href="${esc(r.repoUrl)}${r.baseSha ? `/tree/${esc(r.baseSha)}` : ""}">${esc(r.repoUrl.replace(/^https?:\/\//, ""))}</a>${r.baseSha ? ` at <code>${esc(r.baseSha.slice(0, 7))}</code>` : ""}` : "repository not recorded"}</li>
                <li>${r.account ? `account <code>${esc(r.account)}</code> · ` : ""}${r.envClean === true ? "clean at launch" : r.envClean === false ? '<span class="tag warn">account failed the preflight</span>' : "provenance not stamped"}</li>
                ${r.toolErrors.length ? `<li class="warn">${plural(r.toolErrors.length, "tool error")}: ${esc(clip(r.toolErrors.join("; "), ERRORS_SHOWN))}</li>` : ""}
              </ul>
            </div>
            <div>
              <h4>What it did, in order <span class="muted">· ${r.toolTimeline.length}${r.toolTimeline.length > TIMELINE_SHOWN ? `, first ${TIMELINE_SHOWN} shown` : ""}</span></h4>
              <div class="scrollbox">${timeline}</div>
              <h4>What it said <span class="muted">· every assistant message in order · ${n((r.text ?? "").length)} characters</span></h4>
              @@ANSWER@@
            </div>
          </div>
        </td>
      </tr>`.replace(/\n\s+/g, "\n").replace("@@ANSWER@@", answer);
}

function explorer(rows: AgentRow[], b: AgentBenchmark, listed: (p: string) => boolean): string {
  const adoptedValues = [...new Set(rows.map((r) => {
    const gradeable = r.status !== "error" && !!r.reach && r.reach !== "voided";
    return r.status === "error" ? "(error)" : r.reach === null ? "(not graded)" : !gradeable ? "(voided)" : r.adopted ?? "(none)";
  }))].sort();
  const opt = (v: string) => `<option value="${esc(v)}">${esc(v)}</option>`;
  return `
    <div class="filters" id="filters">
      <label>Repository <select id="f-repo"><option value="">all</option>${b.repositories.map(opt).join("")}</select></label>
      <label>Frame <select id="f-frame"><option value="">all</option>${b.frames.map(opt).join("")}</select></label>
      <label>Adopted <select id="f-adopted"><option value="">all</option>${adoptedValues.map(opt).join("")}</select></label>
      <label><input type="checkbox" id="f-review"> needs a human’s eye only</label>
      <button type="button" id="f-expand">expand all</button>
      <span class="muted" id="f-count"></span>
    </div>
    ${rows.length ? `
    <div class="scroll">
    <table class="runs">
      <caption class="sr-only">Every run: what it committed to, what it wrote, what it read</caption>
      <thead><tr>
        <th scope="col">Repository</th><th scope="col">Frame</th><th scope="col" class="num">Rep</th>
        <th scope="col">Adopted</th><th scope="col">Read from</th><th scope="col">Decided from</th>
        <th scope="col" class="num">Files</th><th scope="col">Web</th><th scope="col" class="num">Took</th>
      </tr></thead>
      <tbody>${rows.map((r) => runRow(r, listed)).join("")}</tbody>
    </table>
    </div>` : `<p class="empty">Nothing has run yet.</p>`}`;
}

function provenance(b: AgentBenchmark): string {
  const p = b.provenance;
  return `
    <table>
      <caption class="sr-only">Where these runs came from</caption>
      <tbody>
        <tr><th scope="row">Agent</th><td>${esc(b.surfaceLabel)} <span class="muted">${esc(b.surfaceKey)}</span></td></tr>
        <tr><th scope="row">Model asked for</th><td><code>${esc(p.modelRequested ?? "none")}</code></td></tr>
        <tr><th scope="row">Model served</th><td>${p.modelsServed.length
          ? p.modelsServed.map((m) => `<code>${esc(m.model)}</code> <span class="muted">${plural(m.runs, "run")}</span>`).join(" · ")
          : '<span class="muted">no run has answered yet</span>'}${p.drift ? ` <span class="tag warn">${p.drift} answered by a different model than planned</span>` : ""}</td></tr>
        <tr><th scope="row">Sandbox image</th><td>${p.images.length ? p.images.map((v) => `<code>${esc(v)}</code>`).join(", ") : '<span class="muted">none: ran on the host</span>'}${p.images.length > 1 ? ' <span class="tag warn">more than one image</span>' : ""}</td></tr>
        <tr><th scope="row">CLI release</th><td>${p.cliVersions.length ? p.cliVersions.map((v) => `<code>${esc(v)}</code>`).join(", ") : "—"}${p.cliVersions.length > 1 ? ' <span class="tag warn">more than one release</span>' : ""}</td></tr>
        <tr><th scope="row">Account</th><td>${p.accounts.length ? p.accounts.map((a) => `<code>${esc(a)}</code>`).join(", ") : "—"} · ${p.clean === true ? "clean at launch: no deploy credential on disk, no global CLAUDE.md, no user-scope MCP server, every deploy CLI shimmed" : p.clean === false ? '<span class="tag warn">failed the preflight</span>' : "not stamped"}</td></tr>
        <tr><th scope="row">When</th><td>${date(p.firstRunAt)}${p.lastRunAt && p.lastRunAt !== p.firstRunAt ? ` to ${date(p.lastRunAt)}` : ""}</td></tr>
        <tr><th scope="row">Cell duration</th><td>${p.durationMedianMs === null ? "—" : `median ${dur(p.durationMedianMs)} · ${dur(p.durationMinMs)} to ${dur(p.durationMaxMs)}`}</td></tr>
      </tbody>
    </table>`;
}

// ------------------------------------------------------------------ page

export function renderAgentReport(
  b: AgentBenchmark,
  rows: AgentRow[],
  platforms: { name: string }[],
  meta: ReportMeta,
): string {
  const listedNames = new Set(platforms.map((p) => p.name));
  const listed = (p: string) => listedNames.has(p);
  const leader = b.adoption[0];
  const st = b.stability;
  const unlisted = b.adoption.filter((a) => !a.listed && a.adopted > 0);

  const findings = b.gradeable ? `
  <section class="findings" aria-label="What the runs show">
    <div class="finding">
      <div class="k">${leader && leader.adopted ? pct(leader.share) : "—"}</div>
      <p>${leader && leader.adopted
        ? `of gradeable runs committed to <strong>${esc(leader.platform)}</strong> — ${leader.adopted} of ${b.gradeable}${leader.ci ? `, plausibly anywhere from ${pct(leader.ci.lo)} to ${pct(leader.ci.hi)} once you allow for how few repositories this is` : ""}.`
        : "of runs committed to any platform."}</p>
    </div>
    <div class="finding">
      <div class="k">${b.byRepository.filter((r) => r.gradeable).length}<span class="of">/${b.repositories.length}</span></div>
      <p>repositories with gradeable runs. Read the choice per repository, because the workload decides it: ${
        b.byRepository.filter((r) => r.gradeable && r.adopted.length).map((r) => `<strong>${esc(r.target)}</strong> ${esc(r.adopted[0].platform)} ${r.adopted[0].n}/${r.gradeable}`).join("; ") || "none has a gradeable run yet"}.</p>
    </div>
    <div class="finding">
      <div class="k">${st.flipRate === null ? "—" : pct(st.flipRate)}</div>
      <p>${st.flipRate === null
        ? "of cells changed their mind between repeats — not measurable yet, no cell has two finished repeats."
        : `of cells changed their mind between repeats (${st.flipped} of ${st.comparable}).`}</p>
    </div>
  </section>
  <p class="rule"><strong>Reading rule.</strong> Where two brackets overlap, those outcomes are not ranked against each
    other, within a frame or across frames${st.flipRate === null ? "" : "; a gap smaller than the flip rate is this instrument’s own noise, not a finding"}.</p>` : "";

  return `<title>${esc(meta.title)}</title>
<style>
  :root {
    color-scheme: light;
    --surface: #fcfcfb; --plane: #f6f6f3; --ink: #0b0b0b; --ink-2: #4f4e4a; --muted: #85837d;
    --grid: #e1e0d9; --bar: #2a78d6; --bar-soft: #dbe8f8; --ci-ink: #0d366b; --warn: #b26a00; --warn-soft: #fff1d6;
    --good: #1f7a3c; --chip: #ecebe6; --chip-ink: #262523;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface: #1a1a19; --plane: #0e0e0d; --ink: #f4f4f1; --ink-2: #c3c2b7; --muted: #8b8a83;
      --grid: #2c2c2a; --bar: #3f8ee8; --bar-soft: #16304d; --ci-ink: #cde2fb; --warn: #e0a24a; --warn-soft: #3a2a0c;
      --good: #5cc57c; --chip: #2a2a28; --chip-ink: #e8e7e1;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface: #1a1a19; --plane: #0e0e0d; --ink: #f4f4f1; --ink-2: #c3c2b7; --muted: #8b8a83;
    --grid: #2c2c2a; --bar: #3f8ee8; --bar-soft: #16304d; --ci-ink: #cde2fb; --warn: #e0a24a; --warn-soft: #3a2a0c;
    --good: #5cc57c; --chip: #2a2a28; --chip-ink: #e8e7e1;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--plane); color: var(--ink);
    font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 1060px; margin: 0 auto; padding: 48px 20px 80px; }
  a { color: inherit; }
  h1 { font-size: 2rem; line-height: 1.15; margin: 4px 0 10px; letter-spacing: -0.02em; }
  h2 { font-size: 1.25rem; margin: 0 0 6px; letter-spacing: -0.01em; }
  h3 { font-size: 1rem; margin: 22px 0 8px; }
  h4 { font-size: .8125rem; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-2); }
  h4:first-child { margin-top: 0; }
  h5 { font-size: .75rem; margin: 10px 0 4px; color: var(--muted); font-weight: 500; }
  p { margin: 0 0 10px; }
  code { font: .85em ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { font: .78rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; margin: 0; }
  .eyebrow { font-size: .8125rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0; }
  .question { font-size: 1.125rem; color: var(--ink-2); margin: 0 0 8px; max-width: 760px; }
  .sub { color: var(--muted); font-size: .9rem; margin: 0 0 14px; }
  .snapshot { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 0 0 22px; padding: 10px 14px; font-size: .8125rem;
    background: var(--surface); border: 1px solid var(--grid); border-radius: 10px; }
  .snapshot div { display: flex; gap: 6px; align-items: baseline; }
  .snapshot dt { color: var(--muted); text-transform: uppercase; font-size: .68rem; letter-spacing: .05em; }
  .snapshot dd { margin: 0; color: var(--ink-2); }
  .lede { color: var(--ink-2); font-size: .9rem; margin: 0 0 16px; max-width: 760px; }
  .disclosure { color: var(--ink-2); font-size: .875rem; margin: -18px 0 22px; max-width: 760px; }
  .changelog { background: var(--surface); border: 1px solid var(--grid); border-left: 3px solid var(--ci-ink); border-radius: 12px; padding: 14px 20px; margin: 0 0 22px; }
  .changelog h4 { margin: 0 0 6px; }
  .changelog ul { margin: 0; padding-left: 18px; font-size: .875rem; color: var(--ink-2); }
  .changelog li { margin: 4px 0; }
  .muted { color: var(--muted); font-weight: 400; }
  .empty { color: var(--muted); font-size: .9rem; border-left: 2px solid var(--grid); padding: 6px 0 6px 12px; }
  .nowrap { white-space: nowrap; }
  section.card { background: var(--surface); border: 1px solid var(--grid); border-radius: 12px; padding: 22px 24px; margin: 0 0 22px; }
  .tabs { display: none; flex-wrap: wrap; gap: 2px; margin: 0 0 22px; border-bottom: 1px solid var(--grid); }
  main.tabbed .tabs { display: flex; }
  .tabs [role="tab"] { font: inherit; font-weight: 500; background: none; border: 0; border-bottom: 2px solid transparent;
    margin-bottom: -1px; padding: 8px 14px; color: var(--muted); cursor: pointer; white-space: nowrap; }
  .tabs [role="tab"]:hover { color: var(--ink); }
  .tabs [role="tab"][aria-selected="true"] { color: var(--ink); border-bottom-color: var(--bar); }
  .tabs [role="tab"]:focus-visible { outline: 2px solid var(--ci-ink); outline-offset: -2px; border-radius: 6px; }
  .panel[hidden] { display: none; }
  .rule { font-size: .875rem; color: var(--ink-2); margin: -10px 0 22px; max-width: 760px; }
  .findings { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0 0 22px; }
  .finding { background: var(--surface); border: 1px solid var(--grid); border-radius: 12px; padding: 18px 20px; }
  .finding .k { font-size: 2.4rem; font-weight: 600; line-height: 1; letter-spacing: -0.03em; margin-bottom: 8px; }
  .finding .of { font-size: 1.2rem; color: var(--muted); font-weight: 500; }
  .finding p { font-size: .875rem; color: var(--ink-2); margin: 0; }
  .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; align-items: start; }

  .chart { display: grid; gap: 2px; margin: 0 0 14px; }
  .row { display: grid; grid-template-columns: 200px minmax(0, 1fr) auto; align-items: center; gap: 12px; }
  .row:hover .bar, .plot:focus-visible .bar { filter: brightness(1.1); }
  .plot:focus-visible { outline: 2px solid var(--ci-ink); outline-offset: 2px; }
  .name { font-size: .8125rem; color: var(--ink-2); text-align: right; line-height: 1.25; }
  .plot { position: relative; min-height: 24px; display: flex; align-items: center; cursor: default; }
  .bar { height: 18px; background: var(--bar); border-radius: 0 4px 4px 0; min-width: 2px; transition: filter .12s ease; }
  .ci-band { position: absolute; top: 50%; transform: translateY(-50%); height: 9px; pointer-events: none;
    border-left: 2px solid var(--surface); border-right: 2px solid var(--surface);
    box-shadow: inset 2px 0 0 var(--ci-ink), inset -2px 0 0 var(--ci-ink); }
  .ci-band::before { content: ""; position: absolute; top: 50%; left: 0; right: 0; height: 2px; transform: translateY(-50%); background: var(--ci-ink); opacity: .55; }
  .val { font-size: .8125rem; color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .floor { font-size: .8125rem; color: var(--muted); margin: 12px 0 16px; padding-top: 12px; border-top: 1px solid var(--grid); }

  table { width: 100%; border-collapse: collapse; font-size: .8125rem; }
  caption { text-align: left; }
  th, td { padding: 7px 8px; border-bottom: 1px solid var(--grid); text-align: left; vertical-align: top; }
  thead th { color: var(--muted); font-weight: 500; font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; }
  tbody th { font-weight: 500; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  tr.dim th, tr.dim td { color: var(--muted); }
  .scroll { overflow-x: auto; }
  .grid td.cell { white-space: nowrap; }
  .grid .repo { display: block; }
  .grid .sha { font: .72rem ui-monospace, Menlo, monospace; color: var(--muted); text-decoration: none; }
  .grid .tick { color: var(--good); margin-left: 4px; font-size: .8rem; }
  .grid td.owed { font-style: italic; }
  .grid td.unanimous { background: color-mix(in srgb, var(--good) 7%, transparent); }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--chip); color: var(--chip-ink); font-size: .75rem; margin: 1px 3px 1px 0; }
  .chip-none { background: transparent; border: 1px solid var(--grid); color: var(--muted); font-style: italic; }
  .chip-void { background: transparent; border: 1px dashed var(--grid); color: var(--muted); }
  .chip-unlisted { border: 1px dashed var(--muted); background: transparent; }
  .chiplink { text-decoration: none; }
  .tag { display: inline-block; font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; padding: 0 6px; border-radius: 4px; border: 1px solid var(--grid); color: var(--muted); vertical-align: middle; }
  .tag.warn { color: var(--warn); border-color: var(--warn); background: var(--warn-soft); }
  .tally { line-height: 1.7; }
  td.prompt { color: var(--ink-2); max-width: 520px; }

  .filters { display: none; gap: 14px; align-items: center; flex-wrap: wrap; font-size: .8125rem; margin: 0 0 14px; }
  .filters.on { display: flex; }
  .filters select, .filters button { font: inherit; padding: 3px 6px; border: 1px solid var(--grid); border-radius: 6px; background: var(--surface); color: var(--ink); }
  table.runs td, table.runs th { vertical-align: middle; }
  .toggle { font: inherit; font-weight: 500; background: none; border: 0; padding: 0; color: var(--ink); cursor: pointer; text-align: left; }
  .toggle::before { content: "▾ "; color: var(--muted); font-size: .75rem; }
  tr.run.closed .toggle::before { content: "▸ "; }
  tr.detail td { background: color-mix(in srgb, var(--plane) 60%, var(--surface)); padding: 16px 14px 20px; }
  tr.detail.hidden { display: none; }
  tr.run.hidden, tr.run.hidden + tr.detail { display: none; }
  tr.run:target { outline: 2px solid var(--bar); outline-offset: -2px; }
  .detail-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 24px; font-size: .8125rem; }
  .detail-grid .prompt { color: var(--ink-2); }
  .ladder, .files, .trail, .meta { margin: 0; padding-left: 18px; }
  .ladder li, .files li, .trail li, .meta li { margin: 2px 0; word-break: break-word; }
  .meta { list-style: none; padding: 0; color: var(--ink-2); }
  .meta li.warn { color: var(--warn); }
  .conflict { border-left: 2px solid var(--warn); padding: 4px 0 4px 10px; color: var(--ink-2); }
  .reviewed { border-left: 2px solid var(--bar); padding: 4px 0 4px 10px; }
  .scrollbox { max-height: 280px; overflow: auto; border: 1px solid var(--grid); border-radius: 8px; padding: 8px 10px; background: var(--surface); }
  .timeline { margin: 0; padding-left: 26px; font-size: .75rem; }
  .timeline li { margin: 1px 0; color: var(--muted); word-break: break-all; }
  .timeline b { font-weight: 500; color: var(--ink); }
  .answer { max-height: 520px; overflow: auto; border: 1px solid var(--grid); border-radius: 8px; padding: 10px 12px; background: var(--surface); }

  .fx { display: block; max-width: 100%; height: auto; font: 12px ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif; }
  .fx text { fill: var(--ink-2); }
  .fx .fx-head { font-weight: 600; fill: var(--ink); }
  .fx .fx-muted { fill: var(--muted); font-size: 11px; }
  .fx .fx-label { fill: var(--ink-2); }
  .fx .fx-label.none { font-style: italic; fill: var(--muted); }
  .fx .fx-val { fill: var(--muted); font-variant-numeric: tabular-nums; font-size: 11px; }
  .fx .fx-bar { fill: var(--bar); }
  .fx .fx-bar.none { fill: var(--chip); stroke: var(--muted); stroke-dasharray: 3 2; }
  .fx .fx-ci { stroke: var(--ci-ink); stroke-width: 2; stroke-linecap: round; }
  .fx .fx-axis { stroke: var(--ink-2); stroke-width: 1; }
  .fx .fx-grid { stroke: var(--grid); stroke-width: 1; }
  .fx g:hover .fx-bar { filter: brightness(1.1); }
  .briefs { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .brief { border: 1px solid var(--grid); border-radius: 10px; padding: 14px 16px; background: color-mix(in srgb, var(--plane) 40%, var(--surface)); font-size: .8125rem; }
  .brief h3 { margin: 0 0 4px; font-size: 1rem; }
  .brief .brief-k { color: var(--ink-2); margin: 0 0 8px; }
  .brief .brief-k .k { font-size: 1.4rem; font-weight: 600; letter-spacing: -0.02em; color: var(--ink); }
  .brief ul { margin: 0 0 6px; padding-left: 18px; color: var(--ink-2); }
  .brief li { margin: 3px 0; }
  .brief blockquote { margin: 6px 0 0; padding: 6px 0 6px 12px; border-left: 2px solid var(--bar); }
  .brief blockquote p { margin: 0 0 3px; color: var(--ink); }
  .brief cite { font-style: normal; color: var(--muted); font-size: .75rem; }
  .timeline + .more { margin: 6px 0 0; font-size: .75rem; }
  .spine th { width: 130px; color: var(--muted); font-weight: 500; }
  .method ul, .caveats ul, .repro ul { margin: 0; padding-left: 18px; color: var(--ink-2); font-size: .875rem; }
  .method li, .caveats li, .repro li { margin: 5px 0; }
  .repro pre { background: var(--surface); border: 1px solid var(--grid); border-radius: 8px; padding: 12px 14px; margin: 8px 0 14px; }
  .claims { font-size: .78rem; }
  .claims td.deriv { color: var(--ink-2); }
  footer { color: var(--muted); font-size: .8125rem; margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--grid); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  @media (max-width: 760px) {
    .findings, .two, .detail-grid { grid-template-columns: 1fr; }
    .row { grid-template-columns: 110px minmax(0, 1fr) auto; gap: 8px; }
    main { padding: 32px 14px 60px; }
  }
</style>
<main>
  <p class="eyebrow">${esc(meta.eyebrow)}</p>
  <h1>${esc(meta.title)}</h1>
  <p class="question">${esc(meta.question)}</p>
  <p class="sub">${esc(b.surfaceLabel)}
    · ${plural(b.repositories.length, "repository", "repositories")} × ${plural(b.frames.length, "frame")} × ${b.reps} repeats
    · ${b.runs < b.repositories.length * b.frames.length * b.reps ? `${b.runs} of ${n(b.repositories.length * b.frames.length * b.reps)} runs stored so far` : plural(b.runs, "run")}${b.gradeable !== b.runs ? ` (${b.gradeable} gradeable, ${b.voided} voided, ${b.errored} errored${b.ungraded ? `, ${b.ungraded} not graded yet` : ""})` : ""}</p>
  ${snapshot(b, meta)}
  ${meta.disclosure ? `<p class="disclosure">${esc(meta.disclosure)}</p>` : ""}
  ${meta.changelog?.length ? `
  <aside class="changelog" aria-label="What changed">
    <h4>What changed</h4>
    <ul>${meta.changelog.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
  </aside>` : ""}

  <div class="tabs" role="tablist" aria-label="Sections of this report">
    <button type="button" role="tab" id="tab-results" aria-controls="results" aria-selected="true">Results</button>
    <button type="button" role="tab" id="tab-explore" aria-controls="explore" aria-selected="false" tabindex="-1">Explore runs</button>
    <button type="button" role="tab" id="tab-method" aria-controls="method" aria-selected="false" tabindex="-1">Method</button>
  </div>

  <section class="panel" role="tabpanel" id="results" aria-labelledby="tab-results">
  ${findings}

  <section class="card" id="by-frame">
    <h2>By frame, by platform</h2>
    <p class="lede">A column per frame and a row per platform adopted anywhere, plus “no platform”: each bar is that
      platform’s share of the frame’s gradeable runs, each bracket its 95% interval from resampling repositories.</p>
    ${frameChart(b)}
    <h3>The ${plural(b.frames.length, "frame")}, verbatim</h3>
    <p class="lede">The prompt is the only thing that changes between columns. Each is written once and used
      verbatim on every repository; none names a platform, a framework, or a persona.</p>
    <div class="scroll">${frameTable(b)}</div>
  </section>

  <section class="card" id="adoption">
    <h2>What it committed to</h2>
    <p class="lede">Share of gradeable runs in which the agent committed to each platform <em>in code</em>: a
      config file it wrote, a deploy command it wrote, or, failing both, the decision in its closing message.
      Being named in passing is the pale figure in the table, not the bar.</p>
    ${adoptionChart(b)}
    <p class="floor">
      The bracket on each bar is a 95% interval from resampling <em>repositories</em>, because every frame on one
      codebase reads the same tree and meets the same requirements. ${b.repositories.length < 2
        ? "With one repository no interval can be drawn."
        : `With ${plural(b.repositories.length, "repository", "repositories")} it is wide, and that width is the honest one.`}
    </p>
    <div class="scroll">${adoptionTable(b)}</div>
    ${unlisted.length ? `<p class="empty">${unlisted.map((u) => `<strong>${esc(u.platform)}</strong>`).join(", ")} ${unlisted.length === 1 ? "is" : "are"} not in the catalogue of ${platforms.length} platforms this benchmark recognises. ${unlisted.length === 1 ? "It is" : "They are"} recorded under the name the agent used and flagged for a person, not dropped: a benchmark that can only see the platforms it was told about measures its own vocabulary.</p>` : ""}
    ${b.needsReview ? `<p class="empty">${plural(b.needsReview, "run")} ${b.needsReview === 1 ? "is" : "are"} flagged for a human’s eye: the grader could not call ${b.needsReview === 1 ? "it" : "them"} confidently. ${b.needsReview === 1 ? "It is" : "They are"} counted as graded, and a person’s relabel replaces the heuristic.</p>` : ""}
  </section>

  <section class="card" id="for-a-platform">
    <h2>For a platform</h2>
    <p class="lede">Named is how often the agent weighed a platform; adopted is how often it committed. Each card
      gives the frame it wins most, the frame it loses most and, verbatim, what the agent wrote when it weighed the
      platform and chose another; only platforms in the catalogue have a card.</p>
    ${briefCards(meta.briefs, b)}
  </section>

  <section class="card" id="by-repository">
    <h2>By repository, by frame</h2>
    <p class="lede">Each cell is one prompt on one repository, run ${b.reps} times; the chips are what each repeat
      committed to, and a tick means every repeat agreed. A chip opens its run under Explore runs.</p>
    ${repositoryGrid(b, listed)}
  </section>

  ${replicationCard(b, meta)}

  <section class="card" id="decision">
    <h2>How it decided</h2>
    ${decisionSection(b)}
  </section>
  </section>

  <section class="panel" role="tabpanel" id="explore" aria-labelledby="tab-explore">
  <section class="card" id="runs">
    <h2>Every run</h2>
    <p class="lede">Nothing on this page is more than one click from the run it came from. Each row is one repeat of one
      cell: what it committed to and which rung of the ladder that was read from, the files it created or changed,
      every search it ran and every page it opened, the tool calls in order, and its closing message, unedited.</p>
    ${explorer(rows, b, listed)}
  </section>
  </section>

  <section class="panel" role="tabpanel" id="method" aria-labelledby="tab-method">
  <section class="card method" id="how-measured">
    <h2>How this was measured</h2>
    <div class="scroll">
    <table class="spine">
      <tbody>
        <tr><th scope="row">Scene</th><td>A coding agent is handed a real repository, headless, and told to get it running in production. Nothing names a platform.</td></tr>
        <tr><th scope="row">Measure</th><td>Which platform it commits to <em>in code</em> — a config file, a deploy command — and, failing both, the decision in its closing message. Named ≠ adopted.</td></tr>
        <tr><th scope="row">Agent</th><td>${esc(b.surfaceLabel)}, run as <code>claude -p</code> with <code>--dangerously-skip-permissions</code> on a Max subscription. One agent; nothing here says “coding agents”.</td></tr>
        <tr><th scope="row">Design</th><td>${plural(b.frames.length, "frame")} × ${plural(b.repositories.length, "repository", "repositories")} × ${b.reps} repeats = ${plural(b.frames.length * b.repositories.length * b.reps, "planned run")}, crossed: every frame on every repository.</td></tr>
        <tr><th scope="row">Repositories</th><td>Public starters forked to a neutral account and pinned by commit. Any platform config or “deploy to X” guidance already in the tree was stripped in a recorded commit. None belongs to a party with an interest in the result.</td></tr>
        <tr><th scope="row">Blocked</th><td>Every deploy CLI, <code>docker</code>, <code>docker-compose</code> and <code>open</code> are shimmed; credentials and vendor environment variables are stripped from the child. A pick means <em>configured</em>, never <em>deployed</em>.</td></tr>
        <tr><th scope="row">Cost</th><td>Zero marginal: subscription runs. What it costs is nights.</td></tr>
      </tbody>
    </table>
    </div>
    <h3>The rules</h3>
    <ul>
      <li><strong>Adoption is a ladder, and what the agent wrote outranks what it said.</strong> A platform’s config file created or committed since the clone’s base; else a real deploy command in a file it touched; else a decision stated outright in the closing text, read nearest the decision verb; else the review queue with the evidence attached. When files and prose disagree, the closing message wins and the clash is shown.</li>
      <li><strong>A run that did not finish is voided, never scored.</strong> A timeout or a failed exit is a failed measurement, not “no platform”. It is counted, shown, and kept out of every denominator. A provider error leaves the cell owed instead.</li>
      <li><strong>Every cell is repeated ${b.reps} times and the flip rate is published.</strong> How often a cell disagrees with itself is the instrument’s own error bar.</li>
      <li><strong>Intervals resample repositories, not runs.</strong> Four frames on one codebase are four readings of the same tree, not four independent ones. Repeats measure the noise; repositories measure the category, and only more repositories narrow the bracket.</li>
      <li><strong>The catalogue is a recogniser, not a roster.</strong> A run that adopts something outside it is recorded under the name it used and flagged, never dropped and never filed as “other”.</li>
      <li><strong>The heuristics are not the authority.</strong> Anything the grader cannot call confidently is flagged for a person, and a person’s relabel wins. Both are shown.</li>
      <li><strong>Every figure is a query.</strong> Nothing on this page is typed by hand. The claims table lists each number with how it was computed and how many rows support it; a figure with no rows behind it fails the build rather than rendering as a confident zero.</li>
    </ul>
    <h3>Where these runs came from</h3>
    <div class="scroll">${provenance(b)}</div>
  </section>

  ${meta.caveats.length ? `
  <section class="card caveats" id="caveats">
    <h2>What this cannot tell you</h2>
    <ul>${meta.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
  </section>` : ""}

  <section class="card repro" id="reproduce">
    <h2>Reproduce it</h2>
    <p class="lede"><strong>Re-grade</strong> takes minutes and no login: the dataset file carries every closing
      message in full, which is the grader’s input, so every verdict on this page can be re-read from the file alone.
      <strong>Re-run</strong> needs a Mac with Docker, a Claude Max login and about a day; the tool’s repository is
      private while the season is under review, so the dataset file is the published record.</p>
    <h3>Re-grade: minutes, no login</h3>
    <pre>${meta.datasetUrl ? `curl -O ${esc(meta.datasetUrl)}` : `# ${esc(meta.datasetFile)}, committed next to the wave file`}   # every run, its verdict, its evidence and its closing message
npm install && npm test
npm run grade -- ${meta.waveId}                                    # re-grades every stored run at grader ${esc(meta.graderVersion)}; nothing is called
npm run report -- hosting --wave ${meta.waveId} --out out/report.html</pre>
    <ul>
      <li>Re-grading is free because closing messages are stored: <code>npm run grade</code> reads them, never a provider, and a rules change produces a second set of labels to diff rather than an overwrite. The grader version is part of the key.</li>
      <li>The dataset: <a href="${esc(meta.datasetUrl ?? meta.datasetFile)}"><code>${esc(meta.datasetUrl ? meta.datasetUrl.replace(/^.*\//, "") : meta.datasetFile)}</code></a> — ${plural(b.runs, "run")} with frame, repository, repeat, verdict, ladder evidence, files written, decision mode, pages opened, searches, model served, image digest, duration, review flag and any relabel. The figures and claims on this page are in it too.</li>
      <li>A person’s relabel outranks the heuristic and is recorded in the file with its note and date; ${b.provenance.reviewed ? `${plural(b.provenance.reviewed, "run")} carry one` : "none does yet"}.</li>
    </ul>
    <h3>Re-run: about a day on a Max subscription</h3>
    <pre>docker build -t ${esc(b.provenance.sandboxes[0]?.image ?? "aeo-sandbox:s0")} sandbox/               # this season ran on ${b.provenance.sandboxes.length ? b.provenance.sandboxes.map((sb) => esc(sb.digest ? `${sb.image}@${sb.digest}` : sb.image)).join(", ") : "the host, not an image"}
claude setup-token                                    # once; save the token to ~/.config/aeo/claude-oauth-token (chmod 600)${b.provenance.cliVersions.length ? `
#   Claude Code ${esc(b.provenance.cliVersions.join(", "))}: the wave file pins the release and the preflight refuses any other` : ""}
npm run plan -- ${esc(meta.waveFile)}                 # plans the wave, prints its id N
npm run preflight -- hosting --wave N --benchmark     # must end "Clear to run."
npm run run-wave -- --wave N                          # about a day; the runner waits out usage windows; re-run the same command to resume
npm run grade -- N
npm run report -- hosting --wave N --compare-wave ${meta.waveId} --out out/report.html</pre>
    <ul>
      <li>Every cell runs in its own container from that image and the container is removed after it: no keychain, no git credential, no deploy CLI that works, and no run can read another’s work. The run stores the image digest, the CLI release and the model that answered.</li>
      <li>The model is asked for explicitly (<code>--model ${esc(b.provenance.modelRequested ?? "…")}</code>) and every run stores the model the transcript says answered. If they differ, the snapshot at the top says so.</li>
      <li>Repositories are cloned at the pinned commit on every run; the wave file carries the commits.</li>
      <li>A Max subscription closes its usage window several times a day. The runner treats a closed window as “come back later”, not as an answer: the cell stays owed, nothing is stored, and the wave resumes when the window opens.</li>
    </ul>
  </section>

  <section class="card" id="claims">
    <h2>Every number on this page</h2>
    <p class="lede">Each figure on this page, with the sentence that computes it and the number of stored rows it rests on. A claim with nothing behind it fails the build.</p>
    <div class="scroll">
    <table class="claims">
      <thead><tr><th scope="col">Claim</th><th scope="col" class="num">Value</th><th scope="col">Derivation</th><th scope="col" class="num">Rows</th></tr></thead>
      <tbody>${meta.claims.map((c) => `
        <tr id="claim-${esc(slug(c.id))}"><th scope="row">${esc(c.label)}</th><td class="num">${esc(String(c.value))}</td><td class="deriv">${esc(c.derivation)}</td><td class="num">${c.support}</td></tr>`).join("")}
      </tbody>
    </table>
    </div>
  </section>
  </section>

  <footer>Generated ${meta.generatedAt.toISOString().slice(0, 10)} from stored runs · ${esc(meta.waveName)} · every figure traceable to the run that produced it.</footer>
</main>
<script>
(function () {
  var runs = Array.prototype.slice.call(document.querySelectorAll("tr.run"));
  if (!runs.length) return;
  var filters = document.getElementById("filters");
  var fRepo = document.getElementById("f-repo"), fFrame = document.getElementById("f-frame"),
      fAdopted = document.getElementById("f-adopted"), fReview = document.getElementById("f-review"),
      fCount = document.getElementById("f-count"), fExpand = document.getElementById("f-expand");
  filters.classList.add("on");

  function detailOf(tr) { return document.getElementById(tr.getAttribute("id").replace("run-", "detail-")); }
  function setOpen(tr, open) {
    tr.classList.toggle("closed", !open);
    detailOf(tr).classList.toggle("hidden", !open);
    tr.querySelector(".toggle").setAttribute("aria-expanded", open ? "true" : "false");
  }
  runs.forEach(function (tr) {
    setOpen(tr, false);
    tr.querySelector(".toggle").addEventListener("click", function () { setOpen(tr, tr.classList.contains("closed")); });
  });
  var allOpen = false;
  fExpand.addEventListener("click", function () {
    allOpen = !allOpen;
    runs.forEach(function (tr) { if (!tr.classList.contains("hidden")) setOpen(tr, allOpen); });
    fExpand.textContent = allOpen ? "collapse all" : "expand all";
  });

  function apply() {
    var shown = 0;
    runs.forEach(function (tr) {
      var ok = (!fRepo.value || tr.dataset.repo === fRepo.value)
        && (!fFrame.value || tr.dataset.frame === fFrame.value)
        && (!fAdopted.value || tr.dataset.adopted === fAdopted.value)
        && (!fReview.checked || tr.dataset.review === "1");
      tr.classList.toggle("hidden", !ok);
      if (ok) shown += 1;
    });
    fCount.textContent = shown + " of " + runs.length + " runs";
  }
  [fRepo, fFrame, fAdopted, fReview].forEach(function (el) { el.addEventListener("change", apply); });

  // A link from elsewhere can arrive pre-filtered: ?repo=…&frame=…&adopted=…&review=1.
  // An unknown value leaves the select empty, so a stale link degrades to "no filter".
  var q = new URLSearchParams(location.search);
  function preset(sel, v) { if (v && Array.prototype.some.call(sel.options, function (o) { return o.value === v; })) sel.value = v; }
  preset(fRepo, q.get("repo")); preset(fFrame, q.get("frame")); preset(fAdopted, q.get("adopted"));
  if (q.get("review") === "1") fReview.checked = true;
  apply();

  // A chip in the grid points at a run: open it when arriving by hash.
  function openTarget() {
    var id = location.hash.replace("#", "");
    var tr = id && document.getElementById(id);
    if (tr && tr.classList.contains("run")) { tr.classList.remove("hidden"); setOpen(tr, true); }
  }
  window.addEventListener("hashchange", openTarget);
  openTarget();
})();
(function () {
  // Three tabs over the same three panels the page shows stacked without JavaScript. The
  // active one lives in the hash, so #explore is a link and #run-123 opens the tab that holds it.
  var main = document.querySelector("main");
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
  if (!tabs.length || panels.some(function (p) { return !p; })) return;
  main.classList.add("tabbed");
  var bar = tabs[0].parentNode;

  function select(i) {
    tabs.forEach(function (t, j) {
      t.setAttribute("aria-selected", j === i ? "true" : "false");
      t.tabIndex = j === i ? 0 : -1;
      panels[j].hidden = j !== i;
    });
  }
  function go(i, focus) {
    select(i);
    history.replaceState(null, "", "#" + panels[i].id);
    if (bar.getBoundingClientRect().top < 0) bar.scrollIntoView();
    if (focus) tabs[i].focus();
  }
  function panelOf(el) {
    for (var i = 0; i < panels.length; i++) if (panels[i] === el || panels[i].contains(el)) return i;
    return -1;
  }
  function fromHash() {
    var el = location.hash.length > 1 && document.getElementById(location.hash.slice(1));
    var i = el ? panelOf(el) : -1;
    if (i < 0) { select(0); return; }
    select(i);
    if (el !== panels[i]) el.scrollIntoView();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { go(i, false); });
    t.addEventListener("keydown", function (e) {
      var j = e.key === "ArrowRight" ? (i + 1) % tabs.length
        : e.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length
        : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      go(j, true);
    });
  });
  window.addEventListener("hashchange", fromHash);
  fromHash();
})();
</script>`;
}

/** The same page as a complete HTML document, for a file on disk. */
export function wrapDocument(fragment: string, lang = "en"): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${fragment.replace(/<main>[\s\S]*$/, "").trim()}
</head>
<body>
${fragment.slice(fragment.indexOf("<main>"))}
</body>
</html>`;
}
