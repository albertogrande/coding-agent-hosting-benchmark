/**
 * Grades one stored answer: how the brand appears, not merely whether it does.
 *
 * Ported from the AEO project's `reparse-stance.py`, whose heuristics are sound and are
 * kept behaviour-for-behaviour so the port can be diffed against its committed output.
 * A plain alias match scores "Koyeb is simpler but gets expensive, so use Render" the
 * same as a recommendation; the ladder below separates them, and every label carries the
 * sentence it was read off so a human can check it.
 *
 * These are heuristics over markdown, not a classifier. That is why `evidence` exists,
 * why `needsReview` exists, and why the version is stored with the grade: changing the
 * rules produces a new set of grades to diff, never a silent overwrite of the old ones.
 */
import type { Alias } from "@/db/schema";

/**
 * Bump when the rules change. Grades are stored per version so a re-grade is a diff.
 *
 * stance-4 (2026-09-10): the adoption ladder reads the deciding sentence rather than the
 * whole markdown line, and a negated decision verb no longer counts as a decision. Four
 * runs of wave 3 move; three of them land on the label the review had already corrected by
 * hand, and run 191 — which argued against Fly.io and was recorded as adopting it — becomes
 * unresolved instead of wrong.
 *
 * stance-5 (2026-10-21): decision mode counts web content read from the shell. A run that
 * `curl`-ed a vendor's docs was filed as prior knowledge; it is now `shell`
 * (`src/derive/shell-lookups.ts`). Labels and adoption are unchanged.
 *
 * stance-6 (2026-10-25): `platformsNamed` is three corrections stricter. Ambiguous aliases
 * ("Render", "Fly") stay case-sensitive even when a project sets `caseSensitive: false`, which
 * every published alias list did, so "on the fly" no longer names Fly.io. A generic alias
 * ("Workers") never names a platform on its own: it matched gunicorn and background workers
 * in 24 of the 38 season 1 runs that "named" Cloudflare. And a platform a run names only as a
 * stubbed deploy tool is not named. Labels, adoption and decision mode are unchanged.
 */
export const GRADER_VERSION = "stance-6";

/**
 * How a *chat* answer treated one platform. The question that arm asks is about a subject, so
 * its vocabulary is relative to one — and a stored value in it always names whom.
 */
export type Stance = "absent" | "mentioned" | "shortlisted" | "recommended" | "voided";

/**
 * How far an *agent* run got toward a decision, said without reference to any platform.
 *
 * A category benchmark has no subject, so the agent arm cannot store a stance: it stores what
 * the run reached, and the ladder for any platform is derived while reading by `stanceFor`.
 * Deliberately a different set of words. Reusing "recommended" would have made one term mean
 * "got as far as deciding" in the stored table and "this platform won" in the view beside it,
 * which is the ambiguity that made the repeat-stability figure move with the lens.
 */
export type Reach = "decided" | "considered" | "silent" | "voided";
export const REACH_STAGES: Reach[] = ["silent", "considered", "decided"];

export type Grade = {
  stance: Stance | Reach;
  /** prior | search | shell | fetch — set for agent runs, absent for chat. */
  decisionMode?: string;
  /** The brand's position among tracked platforms, by first appearance. Null if absent. */
  brandRank: number | null;
  platformsNamed: string[];
  /** The platform the answer picks by its own verdict; "(other)" when it commits to
   *  something outside the tracked vocabulary, null when it never commits. */
  winner: string | null;
  /** A hedge or negative in a sentence naming the brand. Not the same as hostile. */
  caveat: boolean;
  evidence: string;
  needsReview: boolean;
};

/**
 * Aliases that are ordinary English words in deployment prose — "render the template",
 * "fly to the region" — and so always match case-sensitively, alias by alias. A project's
 * `caseSensitive: false` cannot lift this: every published alias list set it, and under
 * stance-5 "on the fly" named Fly.io. `caseSensitive: true` makes every alias exact.
 */
const AMBIGUOUS = new Set(["render", "fly", "deploy", "wave", "scale", "edge", "vault"]);

/**
 * Aliases too generic to name a platform on their own. "Workers" is how gunicorn, uwsgi and
 * Render describe their processes, and it was most of what "named Cloudflare" counted. They
 * still count inside a longer alias ("Cloudflare Workers"), never alone.
 */
const GENERIC = new Set(["workers", "pages", "functions"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An alias that matches in any case, inside a pattern that has no `i` flag. */
const anyCase = (s: string) => escapeRe(s).replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);

export type Platform = { name: string; re: RegExp };

/**
 * One pattern per platform, from the project's own brand and competitor lists. Case is
 * decided per alias, so the pattern carries no `i` flag: an alias that may match in any case
 * spells its letters as classes.
 *
 * A platform with no aliases matches **nothing**, and the guard is not theoretical: an empty
 * alias list builds the alternation `(?:)`, which matches at every position, so every
 * platform reads as named in every run. A store seeded that way produced a dataset reporting
 * all thirteen platforms named in all 132 runs — destroying "named against chosen", the
 * figure the season rests hardest on, with no error anywhere. Matching nothing is the honest
 * failure: the count reads zero and someone asks why.
 */
export function platformPatterns(platforms: Alias[]): Platform[] {
  return platforms.map((p) => {
    const parts = p.aliases
      .filter((a) => !GENERIC.has(a.toLowerCase()))
      .map((a) => (p.caseSensitive || AMBIGUOUS.has(a.toLowerCase()) ? escapeRe(a) : anyCase(a)));
    const re = parts.length ? new RegExp(`(?<![\\w.])(?:${parts.join("|")})(?![\\w])`, "g") : /(?!)/g;
    return { name: p.name, re };
  });
}

/** Each stubbed deploy CLI in `sandbox/Dockerfile`, by the platform it belongs to. */
export const STUB_CLIS: Record<string, string> = {
  render: "Render", railway: "Railway", fly: "Fly.io", flyctl: "Fly.io", vercel: "Vercel",
  netlify: "Netlify", wrangler: "Cloudflare", gcloud: "Google Cloud Run", heroku: "Heroku",
  doctl: "DigitalOcean App Platform", koyeb: "Koyeb", northflank: "Northflank", coolify: "Coolify",
};

/** The sandbox's own words for a stubbed CLI, as the closing texts report it. */
export const STUB_SENTENCE = /\b(stub(s|bed)?|shims?|placeholders?|not available|configure[- ]only|blocked|refuses?|disabled)\b/i;

/**
 * Whether a text names a platform only as one of the sandbox's stubbed tools. Every sentence
 * that names it either says so in the sandbox's own words, or names it only as its lowercase
 * command (`railway`, not `Railway` or `railway.json`). "CLI" alone is not enough: "Fly
 * schedules are set by CLI, Railway's in the dashboard" is a reason, not a stub report.
 *
 * Mentions are found with the platform's own pattern, never by splitting words, so "Fly.io"
 * and "Cloud Run" are read whole. A word split dropped "Fly.io was the runner-up" as a stub
 * mention.
 */
export function namedOnlyAsStub(text: string, p: Platform): boolean {
  const commands = Object.keys(STUB_CLIS).filter((c) => STUB_CLIS[c] === p.name);
  // A copy, because `matchAll` starts at the pattern's `lastIndex`, and a caller that has just
  // run `exec` on it leaves that past the start of every short sentence.
  const re = new RegExp(p.re.source, p.re.flags);
  const sentences = text.split(/(?<=[.!?])\s+|\n/)
    .map((s) => ({ s, hits: [...s.matchAll(re)].map((m) => m[0]) }))
    .filter((x) => x.hits.length);
  return sentences.length > 0
    && sentences.every((x) => STUB_SENTENCE.test(x.s) || x.hits.every((h) => commands.includes(h)));
}

const find = (re: RegExp, text: string) => {
  re.lastIndex = 0;
  return re.exec(text);
};

// A heading that announces the answer. The verdict is either on the heading line itself
// ("## Recommendation: **Render**") or on the first non-empty line under it.
const REC_HEAD =
  /^#{1,6}\s*(?:recommendation|recommended|verdict|bottom line|the pick|my pick|tl;?dr|final answer|short answer|conclusion)\b[:\s—-]*(.*)$/gim;

// Sections that exist to list options rather than to pick one.
const ALT_HEAD =
  /^#{1,6}\s*.*(?:alternativ|other option|also consider|runner|honorable|comparison|options|shortlist|contenders)/i;

// Verdict phrasings that are unmistakable regardless of which platform they name.
const STRONG_CUE = /(?:my recommendation is|the winner is|best (?:choice|option|pick|bet) is)[^.\n]{0,60}/gi;

// A verdict stated in the opening paragraph with no heading to announce it.
const OPENING_VERDICT =
  /(?:is|are)\s+(?:the\s+)?(?:\w+\s+){0,3}?(?:platform|choice|option|pick|bet|fit)\b[^.\n]{0,40}?(?:I(?:'d|’d| would)|recommend)|I(?:'d|’d| would)\s+(?:recommend|point you to|start with|reach for|default to)/i;

// Presence means the sentence is not a clean endorsement — not that it is hostile.
const CAVEAT =
  /\b(?:but|however|though|although|caveat|downside|drawback|trade-?off|expensive|pricey|costl|lacks?|lacking|limited|limitation|missing|no\s+(?:free|built-in|managed|official)|not\s+(?:as|the|ideal|suitable)|less\s+\w+|worse|weaker|harder|requires? more|only if|unless|beware|watch out)\b/i;

const SENT = /[^.!?\n]*[.!?]|[^\n]+/g;

function brandPatterns(brand: Alias) {
  const alt = brand.aliases.map(escapeRe).join("|");
  return {
    // "I'd go with Koyeb", focal-only: the others appear in this family mostly inside
    // conditionals ("I'd choose Fly.io if you need…"), which is not a verdict.
    pick: new RegExp(
      `(?:I(?:'d|’d| would)?\\s+(?:choose|pick|go with|recommend|suggest|use)|go with|my recommendation is|the winner is|best (?:choice|option|pick|bet) is)[^.\\n]{0,40}?\\*{0,2}(${alt})\\*{0,2}(?![\\w])`,
      "i",
    ),
    isBest: new RegExp(
      `\\*{0,2}(${alt})\\*{0,2}\\s+(?:is|remains|would be)\\s+(?:\\w+\\s+){0,3}?(?:the\\s+)?(?:best|strongest|right|top|winner|clear winner|safest|default|sweet spot)`,
      "i",
    ),
  };
}

function sentencesWith(text: string, re: RegExp): string[] {
  return (text.match(SENT) ?? []).map((s) => s.trim()).filter((s) => s && find(re, s));
}

/** The markdown line an offset falls on, plus the nearest heading above it. */
function lineContext(text: string, idx: number): { line: string; head: string } {
  const start = text.lastIndexOf("\n", idx - 1) + 1;
  const end = text.indexOf("\n", idx);
  const line = text.slice(start, end === -1 ? undefined : end);
  const heads = text.slice(0, idx).match(/^#{1,6}\s*.*$/gm) ?? [];
  return { line, head: heads[heads.length - 1] ?? "" };
}

/**
 * Whichever tracked platform is named earliest in a fragment.
 *
 * Answers routinely name two in one verdict — "Choose Render unless you have a reason to
 * favour Koyeb" — so asking "is the focal platform in here" labels the runner-up as the pick.
 * Position decides it: the platform the clause leads with is the one it picks.
 */
function firstPlatform(fragment: string, platforms: Platform[]): string | null {
  let best: { name: string; at: number } | null = null;
  for (const p of platforms) {
    const m = find(p.re, fragment);
    if (m && (!best || m.index < best.at)) best = { name: p.name, at: m.index };
  }
  return best?.name ?? null;
}

function findWinner(text: string, platforms: Platform[], brand: Alias): { winner: string | null; evidence: string } {
  REC_HEAD.lastIndex = 0;
  for (let h = REC_HEAD.exec(text); h; h = REC_HEAD.exec(text)) {
    let tail = (h[1] ?? "").trim();
    if (!tail) {
      // A bare "## Bottom line" puts the verdict on the next non-empty line.
      const rest = text.slice(h.index + h[0].length).split("\n").filter((l) => l.trim());
      tail = rest[0] ?? "";
    }
    const w = firstPlatform(tail, platforms);
    if (w) return { winner: w, evidence: `${h[0].trim().slice(0, 120)}${tail ? ` | ${tail.slice(0, 120)}` : ""}` };
    if (tail) {
      // It committed, but to something outside the tracked vocabulary. That is a real
      // verdict and not the brand's, so it must not be filed with the answers that never
      // picked at all.
      return { winner: "(other)", evidence: tail.slice(0, 200) };
    }
  }

  const bp = brandPatterns(brand);
  for (const pat of [bp.pick, bp.isBest]) {
    const m = pat.exec(text);
    if (m) {
      // Read from the verb, not the whole sentence: a trailing "...over Railway" must not
      // outrank the platform the clause is actually about.
      const w = firstPlatform(m[0], platforms);
      if (w) return { winner: w, evidence: m[0].trim().slice(0, 200) };
    }
  }

  const opening = text.slice(0, 600);
  if (OPENING_VERDICT.test(opening)) {
    const w = firstPlatform(opening, platforms);
    if (w) return { winner: w, evidence: opening.trim().split("\n")[0].slice(0, 200) };
  }

  // Last resort: an explicit verdict phrase about a non-brand platform in prose. The
  // brand-only patterns above never match those, so without this a competitor's prose
  // verdict files as no pick at all. Deliberately last, so earlier passes keep their call.
  STRONG_CUE.lastIndex = 0;
  for (let m = STRONG_CUE.exec(text); m; m = STRONG_CUE.exec(text)) {
    const w = firstPlatform(m[0], platforms);
    if (w) return { winner: w, evidence: m[0].trim().slice(0, 200) };
  }
  return { winner: null, evidence: "" };
}

export type GradeInput = {
  text: string | null;
  /** A run that stopped early is not evidence about the brand. */
  truncated?: boolean;
  status?: string;
};

export function grade(run: GradeInput, brand: Alias, competitors: Alias[]): Grade {
  /**
   * The single most important line in this file. Twelve runs in the original dataset
   * produced no text at all — the output ceiling was spent inside the search loop — and
   * every one was graded `absent`, which reads as "the engines considered the brand and
   * left it out". It means nothing of the kind. A run that could not finish is voided.
   */
  if (run.truncated || run.status === "error" || run.status === "voided") {
    return {
      stance: "voided", brandRank: null, platformsNamed: [], winner: null, caveat: false,
      evidence: run.truncated ? "answer stopped early — not graded" : "run failed — not graded",
      needsReview: false,
    };
  }

  const text = run.text ?? "";
  const platforms = platformPatterns([brand, ...competitors]);
  const brandRe = platforms[0].re;

  const named: { name: string; at: number }[] = [];
  for (const p of platforms) {
    const m = find(p.re, text);
    if (m) named.push({ name: p.name, at: m.index });
  }
  named.sort((a, b) => a.at - b.at);
  const platformsNamed = named.map((n) => n.name);
  const brandIdx = platformsNamed.indexOf(brand.name);
  const brandRank = brandIdx === -1 ? null : brandIdx + 1;

  const { winner, evidence: winnerEvidence } = findWinner(text, platforms, brand);
  const sents = sentencesWith(text, brandRe);
  const caveat = sents.some((s) => CAVEAT.test(s));

  const base = { brandRank, platformsNamed, winner, caveat };

  if (!find(brandRe, text)) {
    // Absent, but an empty answer is not an absence — it is a run that produced nothing,
    // and it deserves a human's eye rather than a row in the funnel.
    return { ...base, stance: "absent", evidence: winnerEvidence, needsReview: text.trim().length === 0 };
  }
  if (winner === brand.name) {
    return { ...base, stance: "recommended", evidence: winnerEvidence, needsReview: false };
  }

  // Carried as one option among several: a comparison-table row, a bullet in an options
  // list, or anything under an "alternatives" heading.
  brandRe.lastIndex = 0;
  for (let occ = brandRe.exec(text); occ; occ = brandRe.exec(text)) {
    const { line, head } = lineContext(text, occ.index);
    if (line.trimStart().startsWith("|") && !/^[\s|:-]+$/.test(line)) {
      return { ...base, stance: "shortlisted", evidence: line.trim().slice(0, 200), needsReview: false };
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line) || ALT_HEAD.test(head)) {
      return { ...base, stance: "shortlisted", evidence: line.trim().slice(0, 200), needsReview: false };
    }
  }

  return {
    ...base,
    stance: "mentioned",
    evidence: sents[0]?.slice(0, 200) ?? "",
    // Named in prose, in no list, with no verdict either way: the class most likely to be
    // mislabelled, so it is queued for a human rather than counted silently.
    needsReview: !winner && sents.length <= 1,
  };
}

// ------------------------------------------------------------------ agent runs

/**
 * Grades an agent run, which decides something different from a chat answer.
 *
 * A chat answer is graded on how the brand *appears*; an agent run is graded on what it
 * *committed to in code*. The two share this table so a wave reads consistently, and the
 * pooling rules keep them from ever being averaged: comparability is within a surface.
 */
export type AgentGradeInput = {
  /** The platform the adoption ladder resolved, or null when it could not. */
  adopted: string | null;
  /** The agent's transcript, for whether the brand was named at all. */
  text: string | null;
  truncated?: boolean;
  status?: string;
  decisionMode?: string;
  /**
   * Set when the ladder's tiers disagreed — the tree said one platform and the closing
   * message another. Whichever won, a person should look: the pilot's two misreads were
   * both clashes, and both were counted without anyone being asked.
   */
  conflict?: string | null;
};

/**
 * Maps whatever the adoption ladder resolved onto the tracked vocabulary.
 *
 * The ladder reads a repository, so it reports what it found there — `GCR` from a comment,
 * `dev-env` when the agent wired up a local environment instead of choosing a host. Stored
 * raw, those are silently different platforms from the ones under measurement: the
 * imported arm has ten runs adopting `GCR` while Google Cloud Run's adoption rate reads
 * zero, because the two strings never meet.
 *
 * An alias resolves to its platform's canonical name. Anything outside the vocabulary is
 * kept **as the agent wrote it**, with `matched: false` so the caller sends it to review.
 *
 * It used to become `(other)`, and that was the wrong contract for this arm. Three cells on
 * a Streamlit repository adopted Streamlit Community Cloud, unanimously and in as many
 * words; all three were filed under `(other)` and the name existed only in an evidence
 * string nobody aggregates. This benchmark has no fixed roster — the platforms in the result
 * are whichever ones the answers name — so collapsing the unrecognised ones makes the report
 * a measure of the list it started with. The chat grader keeps its own `(other)` bucket;
 * this is the agent arm and it is a different question.
 */
export function canonicalPlatform(
  adopted: string,
  platforms: Alias[],
): { name: string; matched: boolean } {
  const needle = adopted.trim().toLowerCase();
  for (const p of platforms) {
    if (p.name.toLowerCase() === needle) return { name: p.name, matched: true };
    if (p.aliases.some((a) => a.toLowerCase() === needle)) return { name: p.name, matched: true };
  }
  return { name: adopted.trim(), matched: false };
}

export function gradeAgentRun(run: AgentGradeInput, platforms: Alias[]): Grade {
  if (run.truncated || run.status === "error" || run.status === "voided") {
    return {
      stance: "voided", brandRank: null, platformsNamed: [], winner: null, caveat: false,
      evidence: run.truncated ? "run did not finish — not graded" : "run failed — not graded",
      needsReview: false,
    };
  }

  const text = run.text ?? "";
  const resolved = run.adopted ? canonicalPlatform(run.adopted, platforms) : null;
  const named: { name: string; at: number }[] = [];
  for (const p of platformPatterns(platforms)) {
    p.re.lastIndex = 0;
    const m = p.re.exec(text);
    // Naming a platform only as a tool the sandbox refused is the sandbox talking, not a
    // platform being weighed. The one the run adopted is named whatever it said.
    if (m && (p.name === resolved?.name || !namedOnlyAsStub(text, p))) named.push({ name: p.name, at: m.index });
  }
  named.sort((a, b) => a.at - b.at);
  const platformsNamed = named.map((n) => n.name);

  // A platform the agent adopted but never spelled out in prose is still one it named.
  if (resolved && !platformsNamed.includes(resolved.name)) platformsNamed.push(resolved.name);

  const base = {
    // Rank is relative to a focal platform, so it is derived while reading, from the order
    // of `platformsNamed`, rather than frozen here against a name nobody chose.
    brandRank: null,
    platformsNamed,
    winner: resolved ? resolved.name : null,
    caveat: false,
    decisionMode: run.decisionMode,
  };

  /**
   * Unresolved is a state, not a verdict. The original left 6 of 21 cells unresolved and
   * they then dropped out of the cross-agent agreement figure entirely, taking it from
   * 21 cells to 15 without saying so.
   */
  if (!run.adopted) {
    return {
      ...base,
      stance: platformsNamed.length ? "considered" : "silent",
      evidence: "no platform could be resolved from the tree or the transcript",
      needsReview: true,
    };
  }
  // The raw string is kept in the evidence whatever happens to it, so canonicalising can
  // never quietly change what a run is recorded as having done.
  const evidence = (resolved!.matched
    ? `adopted ${resolved!.name}`
    : `adopted ${run.adopted}, which is outside the tracked platforms`)
    + (run.conflict ? ` (${run.conflict})` : "");

  return {
    ...base,
    stance: "decided",
    evidence,
    // An outcome outside the vocabulary is a real result and an unresolved one at the same
    // time: the run committed to something, and the report cannot say what it means. A
    // clash between the tree and the prose is a verdict the heuristics made under dispute.
    needsReview: !resolved!.matched || !!run.conflict,
  };
}
