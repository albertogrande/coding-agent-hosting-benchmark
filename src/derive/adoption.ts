/**
 * What platform a coding agent actually adopted.
 *
 * Ported from `harness/parse.py`, which was tuned against a real 21-cell wave. The
 * priority order is the substance: what the agent *wrote* outranks what it *said*,
 * because a config file committed to the repository is the decision, and prose is a
 * description of one.
 *
 *   1. a platform's config file created or modified in the clone
 *   2. a real deploy command in a file the agent touched
 *   3. a decision stated in the closing text
 *   4. nothing conclusive -> needs review, with the evidence attached
 *
 * Tier 4 is not a verdict. The original left 6 of 21 cells unresolved while their
 * evidence column held `said: Vercel` and `recommended: Fly.io` — real decisions the
 * parser declined to make — and those cells then dropped silently out of the
 * cross-agent agreement figure. Here they carry their evidence into a review queue.
 */

export type AdoptionSource = "config-file" | "deploy-artifact" | "final-message" | "unlisted" | "needs-review";

export type Adoption = {
  /** The platform name, or null when nothing conclusive was found. */
  adopted: string | null;
  source: AdoptionSource;
  /** Everything the ladder saw, in the order it saw it. Always populated. */
  evidence: string[];
  /** Set when the files and the prose disagree. The prose wins; the clash is recorded. */
  conflict: string | null;
};

/** A config file in the tree names its platform outright. */
export const CONFIG_FILES: [RegExp, string][] = [
  [/(^|\/)railway\.(json|toml)$/i, "Railway"],
  [/(^|\/)render\.yaml$/i, "Render"],
  [/(^|\/)fly\.toml$/i, "Fly.io"],
  [/(^|\/)vercel\.json$/i, "Vercel"],
  [/(^|\/)netlify\.toml$/i, "Netlify"],

  [/(^|\/)heroku\.yml$/i, "Heroku"],
  [/(^|\/)Procfile$/i, "Heroku"],
  [/(^|\/)apprunner\.yaml$/i, "AWS App Runner"],
  // Before the bare app.yaml below: `.do/app.yaml` ends in `/app.yaml`, so a Cloud Run
  // rule tested first claims every DigitalOcean config. The original had them the other
  // way round and mislabels that file.
  [/(^|\/)\.do\/app\.yaml$/i, "DigitalOcean App Platform"],
  [/(^|\/)(app|cloudbuild)\.yaml$/i, "Google Cloud Run"],
  [/(^|\/)wrangler\.toml$/i, "Cloudflare"],
];

/**
 * What the agent wired up when it used no declarative config file at all. One cell in
 * the original adopted Cloud Run through a shell script and a CI workflow, with no
 * `app.yaml` anywhere and a closing message that never said "I chose" — so both other
 * tiers came up empty. A real deploy command is as concrete as a config file.
 */
export const DEPLOY_CMDS: [RegExp, string][] = [
  [/gcloud\s+run\s+deploy/i, "Google Cloud Run"],
  [/\brailway\s+(?:up|link|deploy)/i, "Railway"],
  [/\b(?:flyctl|fly)\s+deploy/i, "Fly.io"],
  [/\bvercel\s+(?:deploy|--prod)/i, "Vercel"],
  [/\bnetlify\s+deploy/i, "Netlify"],
  [/\bheroku\s+(?:create|git:remote)/i, "Heroku"],
  [/\bwrangler\s+(?:deploy|publish)/i, "Cloudflare"],
  [/\bcopilot\s+(?:init|deploy)/i, "AWS App Runner"],
  [/render\.com\/deploy|renderctl/i, "Render"],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every spelling the recogniser knows, longest first where one contains another — "Fly.io"
 * before "Fly", "Google Cloud Run" before "Cloud Run" — because the alternation is ordered
 * and the shorter one would otherwise win and truncate the name.
 */
const PLATFORM_SPELLINGS = [
  "Railway", "Render", "Fly.io", "Fly", "Vercel", "Netlify", "Heroku",
  "Google Cloud Run", "Cloud Run", "AWS App Runner", "App Runner", "DigitalOcean", "Cloudflare",
] as const;

const PLATFORM_RE = new RegExp(`(${PLATFORM_SPELLINGS.map(escapeRe).join("|")})`, "i");

/** Canonical name for every spelling the platform pattern can match. */
const CANON: [RegExp, string][] = [
  [/^railway$/i, "Railway"],
  [/^render$/i, "Render"],
  [/^fly(\.io)?$/i, "Fly.io"],
  [/^vercel$/i, "Vercel"],
  [/^netlify$/i, "Netlify"],
  [/^heroku$/i, "Heroku"],
  [/^(google )?cloud run$/i, "Google Cloud Run"],
  [/^(aws )?app runner$/i, "AWS App Runner"],
  [/^digitalocean$/i, "DigitalOcean App Platform"],
  [/^cloudflare$/i, "Cloudflare"],
];

export function canon(name: string): string {
  return CANON.find(([re]) => re.test(name.trim()))?.[1] ?? name.trim();
}

/**
 * The same spellings grouped under the canonical name each resolves to.
 *
 * Exported because a store rebuilt from a published dataset has to seed the same vocabulary,
 * and the published record does not carry the project's alias lists. Seeding a platform with
 * no aliases produced a dataset that reported every platform as named in all 132 runs, which
 * silently destroyed the one figure the season rests hardest on — named against chosen.
 */
export const PLATFORM_ALIASES: Record<string, string[]> = PLATFORM_SPELLINGS
  .reduce<Record<string, string[]>>((acc, spelling) => {
    const name = canon(spelling);
    (acc[name] = acc[name] ?? []).push(spelling);
    return acc;
  }, {});

/** Any word that marks a decision, including ones that only weigh options. */
const DECISION_RE =
  /chose|chosen|selected|select\b|adopt(?:ed|ing)?|picked|\bpick\b|going with|went with|settled on|opted for|winner|recommend(?:ed|ation)?|verdict|deploy(?:ing|ed)?\s+(?:to|on)|migrat\w*\s+to|configured\s+(?:it\s+)?for/i;

/**
 * The subset that states a decision outright, as opposed to weighing options or noting
 * what was skipped. "migrating to" is deliberately absent: it shows up in caveats
 * ("rather than migrating to the stateless spec") long after the real choice was made.
 */
const STRONG_RE =
  /\b(?:adopted|adopting|chose|chosen|choosing|selected|picked|went with|going with|settled on|opted for|deploy(?:ing|ed)\s+(?:to|on))\b/i;

/** A run that set up a local environment instead of choosing a platform at all. */
const DEVENV_RE = /dev\s?container|devcontainer|codespaces?|gitpod|github\s+codespaces/i;

const PLATFORM_G = new RegExp(PLATFORM_RE.source, "gi");

/**
 * The platform nearest the decision word *in the same line*.
 *
 * Not the first platform in the line, which is the trap: agents write
 * "compared Google Cloud Run, Railway and LlamaDeploy before adopting Render's Blueprint"
 * — first-in-line reads that as Cloud Run. And not an unbounded scan either: an earlier
 * version of the original ran past a markdown table cell into the next row and turned a
 * Render adoption into a Railway one. Line-scoped, nearest to the verb.
 */
function nearestPlatform(line: string, at: { index: number; length: number }): string | null {
  PLATFORM_G.lastIndex = 0;
  const hits = [...line.matchAll(PLATFORM_G)];
  if (!hits.length) return null;
  const mid = at.index + at.length / 2;
  const best = hits.reduce((a, b) =>
    Math.abs(a.index + a[0].length / 2 - mid) <= Math.abs(b.index + b[0].length / 2 - mid) ? a : b);
  return canon(best[1]);
}

/**
 * A platform the closed vocabulary does not know, read off the sentence that decides.
 *
 * The list above is a recogniser, not a filter, and the difference decides results. Three
 * cells on a Streamlit repository chose Streamlit Community Cloud outright and every one was
 * recorded as "no platform could be resolved", because that name is not in `PLATFORM_RE`.
 * Three confident, unanimous decisions, no winner logged. A benchmark that can only see the
 * platforms it was told about is measuring its own vocabulary.
 *
 * Two shapes carry a verdict, and the second is why the first attempt at this missed all
 * three: a decision verb ("chose X", "going with X"), and a bare copula that none of the
 * decision patterns above match — "Streamlit Community Cloud **is the fit**", "is the pick",
 * "is the right target". The copula form puts the name first, so it is matched on its own.
 *
 * Conservative on purpose: the name must be capitalised, one to four words, and not a
 * sentence opener or a well-known technology. Whatever it finds is flagged for review rather
 * than counted, because an unrecognised string is a candidate and not a verdict. The
 * vocabulary then grows out of the answers instead of bounding them.
 */
const NAME = String.raw`[A-Z][\w-]*(?:\.(?:io|com|dev|app|cloud|sh|ai))?(?:\s+[A-Z][\w-]*(?:\.(?:io|com|dev|app|cloud|sh|ai))?){0,3}`;

/** "<Name> is the pick/fit/choice/winner/answer/target" — a verdict with no verb in it. */
const COPULA_VERDICT = new RegExp(
  String.raw`\b(${NAME})\s+(?:is|are|remains|would be)\s+(?:the|my|our|your)\s+` +
  String.raw`(?:\w+\s+){0,2}(?:pick|fit|choice|winner|answer|target|option|call|way to go)\b`,
  "g",
);

/** "chose/picked/going with <Name>" — a verdict with the name after the verb. */
const VERB_VERDICT = new RegExp(
  String.raw`\b(?:chose|chosen|choosing|selected|picked|went with|going with|settled on|opted for|adopted|adopting|recommend(?:ed)?|deploy(?:ing|ed)?\s+(?:to|on))\s+` +
  String.raw`(?:the\s+)?(${NAME})`,
  "gi",
);

/** Sentence openers and technologies that are never the hosting platform. */
const NOT_A_PLATFORM = new RegExp(
  String.raw`^(?:I|It|Its|The|This|That|A|An|We|You|My|Then|Now|Next|Free|Both|No|Not|For|With|And|But|So|If|After|Before|Here|There|Config|Configuration|Deploy|Deployment|Docker|Dockerfile|Compose|Python|Node|Postgres|PostgreSQL|Redis|SQLite|MySQL|Git|GitHub|README|API|App|Application|Repo|Repository|Service|Server|Container|Image|Build|Tests?|Secrets?|Environment)\b`,
  "i",
);

function acceptable(raw: string): string | null {
  const name = raw.replace(/[.,;:*_]+$/, "").trim();
  if (name.length < 4 || NOT_A_PLATFORM.test(name)) return null;
  // A name the closed list already knows is not "unlisted" — that path has its own tier.
  if (PLATFORM_RE.test(name)) return null;
  return name;
}

/**
 * The leading run of capitalised words, and nothing after it.
 *
 * The verb alternation needs a case-insensitive flag to match "Chose" as well as "chose",
 * and that flag also makes `[A-Z]` match lowercase inside the name pattern — so
 * "going with PythonAnywhere for this one" captured the whole tail. Trimming beats
 * rejecting: the name is the capitalised part, the sentence carries on after it.
 */
function leadingProperNoun(raw: string): string {
  const words = raw.trim().split(/\s+/);
  const kept: string[] = [];
  for (const w of words) {
    if (!/^[A-Z]/.test(w)) break;
    kept.push(w);
  }
  return kept.join(" ");
}

/**
 * The last verdict in the text wins, as everywhere else in this file: agents restate their
 * choice in the closing summary and the closing statement governs.
 */
export function unlistedChoice(text: string): string | null {
  let found: string | null = null;
  for (const raw of text.split("\n")) {
    // Markdown emphasis sits between the name and the copula — agents write
    // "**Streamlit Community Cloud** is the fit" — so it comes out before matching.
    const line = raw.replace(/[*_`]+/g, "").trim();
    if (!line || DEVENV_RE.test(line)) continue;
    for (const re of [COPULA_VERDICT, VERB_VERDICT]) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const name = acceptable(leadingProperNoun(m[1]));
        if (name) found = name;
      }
    }
  }
  return found;
}

export type StatedChoice = {
  platform: string | null;
  line: string;
  /**
   * False when the agent's *last* decision sentence named no platform. One original run
   * closed with "I adopted the dev container" after 25 minutes, and reaching further
   * back turned an earlier bullet list of options into a phantom Cloud Run adoption.
   * Without a config file to corroborate, such a cell belongs in review rather than in
   * the adoption counts.
   */
  confident: boolean;
};

/**
 * Sentence boundaries inside one line.
 *
 * A markdown line is a paragraph, not a sentence, and the difference is a wrong verdict.
 * Run 191 of wave 3 closed a four-sentence paragraph with "picked something that's
 * defensible either way" and, two sentences later, "Fly.io is a reasonable alternative and
 * I can write a `fly.toml` instead" — an offer, conditional on an answer it never got. The
 * line-scoped scan reached across both and recorded a Fly.io adoption for a run that wrote
 * no `fly.toml`, deployed Docker Compose to a Linux VM, and said in as many words that it
 * did *not* reach for Fly.io.
 */
const SENTENCE_SPLIT = /(?<=[.!?])[\s]+/;

/**
 * A decision verb with a negation in front of it decides nothing.
 *
 * "I did not choose Fly.io" and "chose not to deploy to Render" are the two shapes, and
 * both used to read as an adoption of the platform they rule out. Bounded to the 32
 * characters before the verb so a negation earlier in the sentence, about something else,
 * cannot suppress a real decision.
 */
const NEGATED_VERB = /\b(?:not|never|n't|avoid(?:ed|ing)?|without|no\s+longer)\b[^.!?]{0,12}$/i;

/**
 * "chose not to deploy to Render" puts the negation *after* the verb, so a backward window
 * alone misses it. Anchored at the start of what follows, because "chose Render, not Fly.io"
 * also has "not" a few characters later and is a decision.
 */
const NEGATED_AFTER = /^\s*(?:not|never)\b/i;

function negated(sentence: string, at: number, length = 0): boolean {
  return NEGATED_VERB.test(sentence.slice(Math.max(0, at - 32), at))
    || NEGATED_AFTER.test(sentence.slice(at + length, at + length + 8));
}

/**
 * What the agent says it went with, read line by line and, within a line, sentence by
 * sentence.
 *
 * The last qualifying line wins overall: agents restate their choice in the closing
 * summary, and the closing statement governs. Within that line the platform has to sit in
 * the *same sentence* as the verb that decides; a platform named in a neighbouring sentence
 * is a comparison, a caveat or an offer, and reading it as the verdict is how run 191
 * happened. When the deciding sentence names no platform the run is not confident, which
 * sends it to review instead of into the adoption counts — unresolved is a state, not a
 * verdict.
 */
export function statedChoice(text: string): StatedChoice | null {
  let weak: string | null = null;
  // The sentence the weak candidate actually came from. Without it the evidence string
  // quotes the last strong line while naming a platform from somewhere else entirely,
  // which is the one thing a reviewer reading that string must not be shown.
  let weakSentence = "";
  let lastStrongLine: string | null = null;
  let strong: string | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    for (const sentence of line.split(SENTENCE_SPLIT)) {
      const d = DECISION_RE.exec(sentence);
      if (d && !negated(sentence, d.index, d[0].length)) {
        const found = nearestPlatform(sentence, { index: d.index, length: d[0].length });
        if (found) { weak = found; weakSentence = sentence; }
      }
      const st = STRONG_RE.exec(sentence);
      if (st) {
        // A negated verb is not a weaker decision, it is the opposite one. Skipping the
        // sentence entirely leaves the previous real decision standing.
        if (negated(sentence, st.index, st[0].length)) continue;
        lastStrongLine = line;
        strong = nearestPlatform(sentence, { index: st.index, length: st[0].length });
      }
    }
  }

  if (lastStrongLine !== null && !strong && DEVENV_RE.test(lastStrongLine)) {
    // Not a platform at all: the agent built a local environment. A real outcome, and
    // not one that belongs in a hosting adoption count.
    return { platform: "dev-env", line: lastStrongLine.slice(0, 200), confident: true };
  }
  if (lastStrongLine !== null) {
    return {
      platform: strong ?? weak,
      // Quote whichever text the reported platform was actually read from.
      line: (strong ? lastStrongLine : weakSentence || lastStrongLine).slice(0, 200),
      confident: Boolean(strong),
    };
  }
  return weak ? { platform: weak, line: weakSentence.slice(0, 200), confident: false } : null;
}

/** Platforms named by a real deploy command inside files the agent touched. */
export function deployArtifacts(files: { path: string; body: string }[]): string[] {
  const found: string[] = [];
  for (const f of files) {
    if (/\.(md|lock)$/i.test(f.path)) continue;
    for (const [re, platform] of DEPLOY_CMDS) {
      if (re.test(f.body) && !found.includes(platform)) found.push(platform);
    }
  }
  return found;
}

export function configSignals(paths: string[]): string[] {
  const found: string[] = [];
  for (const p of paths) {
    // One file names one platform: the first, most specific rule wins and the rest are
    // not consulted. Otherwise `.do/app.yaml` also matches the bare `app.yaml` rule and
    // a DigitalOcean config reports two adoptions.
    const hit = CONFIG_FILES.find(([re]) => re.test(p));
    if (hit && !found.includes(hit[1])) found.push(hit[1]);
  }
  return found;
}

export type AdoptionInput = {
  /**
   * Files the agent created or modified — the dirty tree *and* anything committed since
   * the clone's base commit. Agents routinely commit their work, which leaves
   * `git status` empty and would hide the strongest signal there is.
   */
  changedFiles: string[];
  /** Bodies of those files, for the deploy-command scan. */
  fileBodies?: { path: string; body: string }[];
  /** The agent's closing text. */
  finalText: string;
};

export function adoption(input: AdoptionInput): Adoption {
  const evidence: string[] = [];

  const signals = configSignals(input.changedFiles);
  if (signals.length) evidence.push(`config: ${signals.join(", ")}`);

  const artifacts = deployArtifacts(input.fileBodies ?? []);
  if (artifacts.length) evidence.push(`deploy command: ${artifacts.join(", ")}`);

  const said = statedChoice(input.finalText);
  if (said?.platform) {
    evidence.push(`said: ${said.platform}${said.confident ? "" : " (unconfirmed)"}${said.line ? ` — "${said.line}"` : ""}`);
  }

  // Asked only when the recognised names came up empty, over the whole closing text rather
  // than one line, because the sentence that decides is not always the one with the verb.
  const unlisted = signals.length || artifacts.length || said?.platform
    ? null
    : unlistedChoice(input.finalText);
  if (unlisted) evidence.push(`said: ${unlisted} — not in the tracked vocabulary`);

  let adopted: string | null = null;
  let source: AdoptionSource = "needs-review";
  let conflict: string | null = null;

  if (signals.length) {
    adopted = signals[0];
    source = "config-file";
    /**
     * When the files and the prose disagree, the prose wins and the clash is recorded.
     * An agent commonly writes one platform's config while exploring and then commits to
     * another in its closing message; the second statement is the decision, but a reader
     * needs to see both to trust the call.
     *
     * Unless the tree says it twice. A config file *and* a deploy command naming the same
     * platform is not exploration left behind, it is a finished deployment, and the prose
     * is then the weaker witness: two pilot cells wrote `fly.toml` and `fly deploy`, and
     * were read as Cloud Run and Render off sentences that were not decisions ("Anyone
     * deploying to Render/Cloud Run/Railway will hit this"). The clash is still recorded,
     * and the grader sends every clash to review.
     */
    // Only a confident statement overrules a written config file. An unconfirmed guess
    // read from an earlier line is weaker evidence than a file in the tree.
    if (said?.platform && said.confident && said.platform !== adopted) {
      if (artifacts.includes(adopted)) {
        conflict = `config file and deploy command both say ${adopted}, closing message says ${said.platform} — the tree wins`;
      } else {
        conflict = `config says ${adopted}, closing message says ${said.platform}`;
        adopted = said.platform;
        source = "final-message";
      }
    }
  } else if (artifacts.length) {
    adopted = artifacts[0];
    source = "deploy-artifact";
    if (said?.platform && said.confident && said.platform !== adopted) {
      conflict = `deploy command says ${adopted}, closing message says ${said.platform}`;
      adopted = said.platform;
      source = "final-message";
    }
  } else if (said?.platform && said.confident) {
    adopted = said.platform;
    source = "final-message";
  } else if (unlisted) {
    // A decision the vocabulary could not name. Recorded as the agent wrote it and sent to
    // review: unrecognised is not the same as undecided, and dropping it silently is how a
    // benchmark ends up measuring the list it started with.
    adopted = unlisted;
    source = "unlisted";
  }
  // An unconfirmed guess with nothing in the tree to corroborate it stays unresolved:
  // it goes to review with its evidence, rather than into the adoption counts.

  return { adopted, source, evidence, conflict };
}

/**
 * How the decision was reached: from the model's weights, from a search result, or from
 * a page it actually opened.
 *
 * Gauge's most useful column, and the agent-side counterpart of running chat with search
 * on versus off. "Never wins before search" is a different and much more actionable
 * finding than "rarely wins".
 */
export type DecisionMode = "prior" | "search" | "fetch";

export function decisionMode(counts: { searches: number; fetches: number }): DecisionMode {
  if (counts.fetches > 0) return "fetch";
  if (counts.searches > 0) return "search";
  return "prior";
}
