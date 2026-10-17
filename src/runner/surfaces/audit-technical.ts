/**
 * Technical AEO audit — how ready a set of domains is to be read by answer engines.
 *
 * Ported from the AEO repo's `audit/aeo-audit.mjs`, whose parsing logic is sound and is
 * kept verbatim in behaviour so the port can be diffed against that script's committed
 * output. What changes here: the brand list becomes project rows, and the result becomes
 * findings in the database instead of a markdown table.
 *
 * Needs no API key, so this is the one surface that works before anything is configured.
 */

/** Retrieval bots decide whether a brand can appear in a live-browsing answer at all;
 *  training bots decide whether it gets into the next model. Both are worth knowing. */
export const AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "CCBot",
  "Bytespider",
  "Applebot-Extended",
  "meta-externalagent",
] as const;

const UA = "aeo-tool/0.1 (+technical-audit)";

export type Fetched = { status: number; ok: boolean; text: string; error?: string };
export type Fetcher = (url: string) => Promise<Fetched>;

export const httpFetcher: Fetcher = async (url) => {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, ok: res.ok, text: res.ok ? await res.text() : "" };
  } catch (err) {
    return { status: 0, ok: false, text: "", error: (err as Error).message };
  }
};

// ------------------------------------------------------------------ llms.txt

/**
 * Single-page apps commonly answer 200 with an HTML shell for a missing path, which
 * would otherwise score as a present llms.txt on every site that has none.
 */
export function looksLikeLlmsTxt(text: string, url: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^<!doctype html|^<html/i.test(t)) return false;
  return t.startsWith("#") || /^[A-Za-z].*\n/.test(t) || url.endsWith(".txt");
}

export type LlmsResult = {
  url: string;
  present: boolean;
  status: number;
  bytes: number;
  /** Markdown links in the file — a curated map with no links is a stub. */
  links: number;
  /**
   * Set when the request itself failed (DNS, TLS, timeout). Status 0 with an error means
   * "not measured", which is a different claim from "measured and absent" — the original
   * script collapsed the two, and a transient failure then read as a finding.
   */
  error?: string;
};

export async function checkLlms(base: string, file: string, get: Fetcher): Promise<LlmsResult> {
  const url = `${base.replace(/\/$/, "")}/${file}`;
  const res = await get(url);
  const valid = res.ok && looksLikeLlmsTxt(res.text, url);
  return {
    url,
    present: valid,
    status: res.status,
    bytes: valid ? res.text.length : 0,
    links: valid ? (res.text.match(/\]\(http/g) ?? []).length : 0,
    ...(res.error ? { error: res.error } : {}),
  };
}

// ------------------------------------------------------------------ robots.txt

type RobotsGroup = { agents: string[]; rules: { type: "allow" | "disallow"; path: string }[]; rulesSeen: boolean };

/**
 * Minimal robots.txt parser. Consecutive `User-agent` lines share one rule block, which
 * is why `rulesSeen` exists: a new agent line after a rule starts a new group.
 */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || current.rulesSeen) {
        current = { agents: [], rules: [], rulesSeen: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rulesSeen = true;
      current.rules.push({ type: key, path: value });
    }
  }
  return groups;
}

export type BotVerdict = {
  verdict: "BLOCKED" | "allowed (explicit)" | "allowed (wildcard)" | "unspecified (allowed)";
  /** True when a group names this bot directly rather than matching it via `*`. */
  specific: boolean;
};

/**
 * Root-level only: this answers "can the bot crawl the site at all", not which paths it
 * may read. A brand blocking a retrieval bot at the root cannot appear in that engine's
 * live answers, which is the finding worth surfacing; per-path policy is a finer question
 * this deliberately does not claim to answer.
 */
export function verdictForBot(groups: RobotsGroup[], bot: string): BotVerdict {
  const lc = bot.toLowerCase();
  let group = groups.find((g) => g.agents.some((a) => a === lc));
  const specific = Boolean(group);
  if (!group) group = groups.find((g) => g.agents.includes("*"));
  if (!group) return { verdict: "unspecified (allowed)", specific };
  const rootBlocked = group.rules.some((r) => r.type === "disallow" && (r.path === "/" || r.path === "/*"));
  return {
    verdict: rootBlocked ? "BLOCKED" : specific ? "allowed (explicit)" : "allowed (wildcard)",
    specific,
  };
}

export function sitemapsIn(text: string): string[] {
  return [...text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
}

export type RobotsResult = {
  url: string;
  present: boolean;
  status: number;
  bots: Record<string, BotVerdict>;
  sitemaps: string[];
  /** As on LlmsResult: a failed request is not evidence that robots.txt is absent. */
  error?: string;
};

export async function checkRobots(site: string, get: Fetcher): Promise<RobotsResult> {
  const url = `${site.replace(/\/$/, "")}/robots.txt`;
  const res = await get(url);
  if (!res.ok) {
    return { url, present: false, status: res.status, bots: {}, sitemaps: [], ...(res.error ? { error: res.error } : {}) };
  }
  const groups = parseRobots(res.text);
  const bots: Record<string, BotVerdict> = {};
  for (const bot of AI_BOTS) bots[bot] = verdictForBot(groups, bot);
  return { url, present: true, status: res.status, bots, sitemaps: sitemapsIn(res.text) };
}

// ------------------------------------------------------------------ JSON-LD

export type StructuredResult = { status: number; blocks: number; types: string[]; error?: string };

/** An unparseable block still counts as present: the engine's parser may be laxer. */
export function extractJsonLd(html: string): { blocks: number; types: string[] } {
  const found = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  const types = new Set<string>();
  for (const [, body] of found) {
    try {
      const parsed = JSON.parse(body.trim());
      const items = Array.isArray(parsed) ? parsed : (parsed["@graph"] ?? [parsed]);
      for (const item of items) {
        const t = item?.["@type"];
        if (typeof t === "string") types.add(t);
        else if (Array.isArray(t)) t.forEach((x: unknown) => typeof x === "string" && types.add(x));
      }
    } catch {
      /* still counted in `blocks` */
    }
  }
  return { blocks: found.length, types: [...types].sort() };
}

export async function checkStructuredData(site: string, get: Fetcher): Promise<StructuredResult> {
  const res = await get(site);
  if (!res.ok) return { status: res.status, blocks: 0, types: [], ...(res.error ? { error: res.error } : {}) };
  return { status: res.status, ...extractJsonLd(res.text) };
}
