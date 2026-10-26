/**
 * Every figure the write-up "Memory first, docs second" prints, computed from this record.
 *
 * The page computes its numbers from the `runs.json` it serves, which `siteDataset` writes
 * from the two published seasons. This module computes the same numbers from the same rows,
 * so a reader can check each one without the page's code. Fig. 6 compares the published
 * waves with the rows `npm run compare` reads. `test/figures.test.ts` pins every value.
 *
 * Pure over the rows and the domain list. `scripts/figures.mts` reads the files and prints.
 */
import { agreementWithInterval, controlReadout } from "./season-compare";
import { splitByProvenance } from "./benchmark";
import { OPEN, rowOfPublished } from "./season-factpack";
import type { AgentRow } from "./agent-benchmark";
import type { PublishedDataset } from "./load-dataset";
import type { SiteRun } from "./site-export";

export const MODELS = ["Opus 5", "Opus 5.5"] as const;
export const BRIEFS: [string, string][] = [
  ["least-effort", "Least effort"],
  ["production", "Production"],
  ["cost", "Cheapest"],
  ["open", "Open"],
];

/** The three briefs with a goal. The open brief is reported on its own row. */
export const GOAL_BRIEFS = ["least-effort", "production", "cost"];

/** Fig. 4 rows: the hosts named often enough to compare against their picks. */
export const NAMED_ROWS = ["Render", "Fly.io", "Vercel", "Railway", "Google Cloud Run", "Cloudflare"];

/** The page's name for a run that picked no outside host. */
export const NO_HOST = "No outside host";

/** A page about price: a pricing page, a free tier or a plan and its limits. */
const PRICE_PAGE = /pricing|free|plans?\b|limits/i;

export type Domain = { domain: string; platform: string };

/** A count out of a total, with the whole percent the page prints. */
export type Share = { n: number; of: number; pct: number };
const share = (n: number, of: number): Share => ({ n, of, pct: Math.round((100 * n) / of) });

type Call = SiteRun["calls"][number];
const isWebCall = (c: Call) => c[0] === "WebSearch" || c[0] === "WebFetch";
const isShellRead = (c: Call) => c[2] === "docs" || c[2] === "lookup";
const loadsWebTools = (c: Call) => c[0] === "ToolSearch" && /WebSearch|WebFetch/.test(c[1]);
const listsStubs = (c: Call) => c[0] === "Bash" && /\bls\b[^|;&]*\/opt\/shims/.test(c[1]);

/** The URLs a run read: every WebFetch, and every URL in a shell call that read the web. */
export function readUrls(calls: Call[]): string[] {
  return calls.flatMap((c) =>
    c[0] === "WebFetch" ? [c[1]] : isShellRead(c) ? c[1].match(/https?:\/\/[^\s"'`)<>]+/g) ?? [] : [],
  );
}

const hostOf = (u: string) => u.replace(/^https?:\/\//, "").split(/[/?#:]/)[0].replace(/^www\./, "").toLowerCase();

/** A URL's platform: its host is the domain or a subdomain of it. */
export function platformResolver(domains: Domain[]) {
  return (u: string): string | null => {
    const h = hostOf(u);
    return domains.find(({ domain }) => h === domain || h.endsWith(`.${domain}`))?.platform ?? null;
  };
}

/** Picks, most first. Ties break by name, so row order in the file does not matter. */
export function tallyPicks(runs: SiteRun[]): [string, number][] {
  const t = new Map<string, number>();
  for (const r of runs) t.set(r.picked ?? NO_HOST, (t.get(r.picked ?? NO_HOST) ?? 0) + 1);
  return [...t].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The platform at least two of a cell's three repeats picked, or null. */
const majorityOf = (runs: SiteRun[]) => {
  const [[name, n] = ["", 0]] = tallyPicks(runs);
  return n >= 2 ? name : null;
};

/** A published wave as Fig. 6 compares it: usable runs, the open brief left out. */
export function fig6Rows(d: PublishedDataset): AgentRow[] {
  const all = d.runs.map((r) => rowOfPublished(r, d)).filter((r) => r.status !== "error");
  return splitByProvenance(all).usable.filter((r) => r.frame !== OPEN);
}

export type Fig6Rows = { s0: AgentRow[]; s0Mac: AgentRow[]; s1: AgentRow[]; s1Night2: AgentRow[]; control: AgentRow[] };

export function writeupFigures(runs: SiteRun[], domains: Domain[], fig6: Fig6Rows) {
  const platformOf = platformResolver(domains);
  const of = (model: string, briefs: string[]) => runs.filter((r) => r.model === model && briefs.includes(r.brief));
  const prior = (rs: SiteRun[]) => rs.filter((r) => r.decided === "prior");
  const apps = [...new Set(runs.map((r) => r.app))];
  const goal = (model: string) => of(model, GOAL_BRIEFS);
  const newer = goal("Opus 5.5");
  const perModel = <T>(f: (model: string) => T) => Object.fromEntries(MODELS.map((m) => [m, f(m)])) as Record<string, T>;

  // Section 3: from memory, and the web tools that had to be loaded first.
  const webRuns = runs.filter((r) => r.calls.some(isWebCall));
  const memoryRuns = prior(runs);
  const newerMemory = prior(newer);
  const memory = {
    share: perModel((m) => share(prior(goal(m)).length, goal(m).length)),
    webRuns: share(webRuns.filter((r) => {
      const first = r.calls.findIndex(isWebCall);
      const load = r.calls.findIndex(loadsWebTools);
      return load >= 0 && load < first;
    }).length, webRuns.length),
    memoryRunsLoaded: share(memoryRuns.filter((r) => r.calls.some(loadsWebTools)).length, memoryRuns.length),
    newerListedStubs: share(newerMemory.filter((r) => r.calls.some(listsStubs)).length, newerMemory.length),
  };

  // Fig. 1 and Fig. 2: decided from memory, and looked something up, per brief.
  const grid = BRIEFS.map(([brief, name]) => ({
    brief, name,
    fromMemory: perModel((m) => share(prior(of(m, [brief])).length, of(m, [brief]).length)),
    lookedUp: perModel((m) => share(of(m, [brief]).length - prior(of(m, [brief])).length, of(m, [brief]).length)),
  }));

  // Section 4: what the newer model read, and when.
  const readers = newer.filter((r) => readUrls(r.calls).length);
  const reads = readers.flatMap((r) => readUrls(r.calls).map((u) => ({ u, p: platformOf(u), picked: r.picked, brief: r.brief })));
  const other = reads.filter((x) => x.p && x.p !== x.picked);
  const platformReaders = newer
    .filter((r) => r.picked)
    .map((r) => ({ r, plats: [...new Set(readUrls(r.calls).map(platformOf).filter(Boolean))] }))
    .filter((x) => x.plats.length);
  const straight = platformReaders.filter(({ r }) => {
    const first = r.calls.find((c) => isWebCall(c) || isShellRead(c))!;
    return first[0] !== "WebSearch" && platformOf(readUrls([first])[0] ?? "") === r.picked;
  });
  const ordered = newer.filter((r) => r.order !== "no reads");
  const order = (o: string) => share(ordered.filter((r) => r.order === o).length, ordered.length);
  const compared = (model: string, briefs: string[]) => {
    const rs = of(model, briefs);
    return share(rs.filter((r) => new Set(readUrls(r.calls).map(platformOf).filter(Boolean)).size >= 2).length, rs.length);
  };
  const docs = {
    ownPlatformRead: share(readers.filter((r) => r.picked && readUrls(r.calls).some((u) => platformOf(u) === r.picked)).length, readers.length),
    otherPlatformReads: share(other.length, reads.length),
    straightToPick: share(straight.length, platformReaders.length),
    firstReadPicked: share(platformReaders.filter((x) => x.plats[0] === x.r.picked).length, platformReaders.length),
    onlyReadPicked: share(platformReaders.filter((x) => x.plats.length === 1 && x.plats[0] === x.r.picked).length, platformReaders.length),
    readBefore: order("read before committing"),
    readAfter: order("read only after committing"),
    readUnknown: order("unknown"),
    comparedCost: perModel((m) => compared(m, ["cost"])),
    comparedElsewhereNewer: compared("Opus 5.5", ["least-effort", "production", "open"]),
    otherReadsCheapest: share(other.filter((x) => x.brief === "cost").length, other.length),
    otherReadsAboutPrice: share(other.filter((x) => PRICE_PAGE.test(x.u)).length, other.length),
  };

  // Fig. 4: named in the closing message against picked, on the briefs with a goal.
  const namedPicked = NAMED_ROWS.map((platform) => ({
    platform,
    byModel: perModel((m) => ({
      named: share(goal(m).filter((r) => r.named.includes(platform)).length, goal(m).length),
      picked: share(goal(m).filter((r) => r.picked === platform).length, goal(m).length),
    })),
  }));

  // Fig. 5: the most-picked platform per brief, and the runner-up.
  const winners = BRIEFS.map(([brief, name]) => ({
    brief, name,
    byModel: perModel((m) => {
      const rs = of(m, [brief]);
      const [[top, nTop], [next, nNext] = ["", 0]] = tallyPicks(rs);
      return { top, topShare: share(nTop, rs.length), next, nextShare: share(nNext, rs.length) };
    }),
  }));

  // Section 6: least effort against production, app by app.
  const differ = perModel((m) => apps.filter((a) => {
    const le = majorityOf(of(m, ["least-effort"]).filter((r) => r.app === a));
    const pr = majorityOf(of(m, ["production"]).filter((r) => r.app === a));
    return le && pr && le !== pr;
  }).length);

  // Fig. 6: cell majorities that held, with the paired interval, and the control.
  const held = (a: AgentRow[], b: AgentRow[]) => {
    const r = agreementWithInterval(a, b);
    return { ...share(r.agreeing, r.comparable), lo: Math.round(100 * r.interval!.lo), hi: Math.round(100 * r.interval!.hi) };
  };
  const control = controlReadout(fig6.control, fig6.s0, fig6.s1);
  const modelUpdate = {
    floorNewer: held(fig6.s1Night2, fig6.s1),
    floorOlder: held(fig6.s0, fig6.s0Mac),
    update: held(fig6.s1, fig6.s0),
    updateAgain: held(fig6.s1Night2, fig6.s0),
    control: { changed: control.changed.length, likeOlder: control.sideS0, likeNewer: control.sideS1, likeNeither: control.neither },
  };

  return { runs: share(runs.length, runs.length), apps: apps.length, memory, grid, docs, namedPicked, winners, differ, modelUpdate };
}

export type WriteupFigures = ReturnType<typeof writeupFigures>;

const s = (x: Share) => `${x.n} of ${x.of} (${x.pct}%)`;

/** The figures as the write-up orders them, one line each. */
export function figureLines(f: WriteupFigures): string[] {
  const [older, newerM] = MODELS;
  const mu = f.modelUpdate;
  return [
    `Memory first, docs second: every figure, from ${f.runs.n} runs of ${f.apps} apps`,
    "",
    "## 3. Half the time, the agent looks nothing up (briefs with a goal)",
    `Decided from memory, ${older}: ${s(f.memory.share[older])}`,
    `Decided from memory, ${newerM}: ${s(f.memory.share[newerM])}`,
    `Runs that searched or opened a page and loaded the web tools first: ${s(f.memory.webRuns)}`,
    `Runs decided from memory that loaded the web tools: ${s(f.memory.memoryRunsLoaded)}`,
    `${newerM} memory runs that listed the stubbed deploy tools: ${s(f.memory.newerListedStubs)}`,
    "",
    "Fig. 1: decided from memory, per brief",
    ...f.grid.map((g) => `  ${g.name}: ${older} ${s(g.fromMemory[older])} · ${newerM} ${s(g.fromMemory[newerM])}`),
    "",
    "## 4. Docs confirm the pick. Price is the exception.",
    "Fig. 2: looked something up, per brief",
    ...f.grid.map((g) => `  ${g.name}: ${older} ${s(g.lookedUp[older])} · ${newerM} ${s(g.lookedUp[newerM])}`),
    `${newerM}, runs that read a page and read the chosen platform's pages: ${s(f.docs.ownPlatformRead)}`,
    `${newerM}, reads of platforms it did not pick, of all reads: ${s(f.docs.otherPlatformReads)}`,
    `${newerM}, runs that read a platform and picked one: first step online opened the pick's page, no search before: ${s(f.docs.straightToPick)}`,
    `${newerM}, the same runs: first platform read was the pick: ${s(f.docs.firstReadPicked)}`,
    `${newerM}, the same runs: read no platform but the pick: ${s(f.docs.onlyReadPicked)}`,
    `${newerM}, runs that read anything: first read before the config file: ${s(f.docs.readBefore)}`,
    `${newerM}, the same runs: read only after: ${s(f.docs.readAfter)} · no config file for the pick: ${s(f.docs.readUnknown)}`,
    `Cheapest brief, read two or more platforms: ${older} ${s(f.docs.comparedCost[older])} · ${newerM} ${s(f.docs.comparedCost[newerM])}`,
    `${newerM}, other briefs, read two or more platforms: ${s(f.docs.comparedElsewhereNewer)}`,
    `${newerM}, reads of platforms it did not pick: on the cheapest brief ${s(f.docs.otherReadsCheapest)} · about price ${s(f.docs.otherReadsAboutPrice)}`,
    "",
    "## 5. Being named is not being picked (briefs with a goal)",
    "Fig. 4: named · picked",
    ...f.namedPicked.map(({ platform, byModel: b }) => `  ${platform}: ${older} ${s(b[older].named)} · ${s(b[older].picked)} | ${newerM} ${s(b[newerM].named)} · ${s(b[newerM].picked)}`),
    "",
    "## 6. The task picks the winner",
    "Fig. 5: most picked · next",
    ...f.winners.map(({ name, byModel: b }) => `  ${name}: ${older} ${b[older].top} ${s(b[older].topShare)} · ${b[older].next} ${s(b[older].nextShare)} | ${newerM} ${b[newerM].top} ${s(b[newerM].topShare)} · ${b[newerM].next} ${s(b[newerM].nextShare)}`),
    `Apps where least effort and production picked different hosts: ${older} ${f.differ[older]} of ${f.apps} · ${newerM} ${f.differ[newerM]} of ${f.apps}`,
    "",
    "Fig. 6: app and brief answers that held, with the 95% range",
    `  ${newerM} run twice: ${s(mu.floorNewer)}, ${mu.floorNewer.lo} to ${mu.floorNewer.hi}%`,
    `  ${older}, a Mac run against a container run: ${s(mu.floorOlder)}, ${mu.floorOlder.lo} to ${mu.floorOlder.hi}%`,
    `  ${older} to ${newerM}, the update: ${s(mu.update)}, ${mu.update.lo} to ${mu.update.hi}%`,
    `  ${older} to the second ${newerM} run: ${s(mu.updateAgain)}, ${mu.updateAgain.lo} to ${mu.updateAgain.hi}%`,
    `  Control, ${older} on the new Claude Code: of ${mu.control.changed} changed answers, ${mu.control.likeOlder} like ${older}, ${mu.control.likeNewer} like ${newerM}, ${mu.control.likeNeither} like neither`,
  ];
}
