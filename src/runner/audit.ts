/**
 * Runs the technical audit for a project and turns the results into findings rows.
 *
 * Findings are one-per-check rather than one-per-domain because a report wants to filter
 * by check ("show me every blocked retrieval bot") at least as often as by domain, and a
 * nested blob cannot be filtered without being unpacked first.
 */
import type { Domain } from "@/db/schema";
import {
  checkLlms,
  checkRobots,
  checkStructuredData,
  httpFetcher,
  type Fetcher,
  type LlmsResult,
  type RobotsResult,
  type StructuredResult,
} from "./surfaces/audit-technical";

/**
 * `unknown` is the status that keeps this instrument honest: it means the check could not
 * be performed, not that it was performed and came back clean. The script this was ported
 * from had no such state — a DNS failure and a genuine 404 both rendered as "absent", so a
 * transient network problem could publish itself as a finding about someone's site.
 */
export type FindingStatus = "pass" | "fail" | "warn" | "info" | "unknown";

export type Finding = {
  target: string;
  check: string;
  subject: string;
  status: FindingStatus;
  summary: string;
  detail: Record<string, unknown>;
};

/** Blocking one of these removes the brand from that engine's live-browsing answers. */
const RETRIEVAL_BOTS = new Set([
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
]);

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function llmsFinding(target: string, where: "site" | "docs", file: string, r: LlmsResult): Finding {
  const isMap = file === "llms.txt";
  if (r.error) {
    return {
      target,
      check: isMap ? "llms_txt" : "llms_full_txt",
      subject: where,
      status: "unknown",
      summary: `could not reach ${file} on ${where}: ${r.error}`,
      detail: { ...r },
    };
  }
  return {
    target,
    check: isMap ? "llms_txt" : "llms_full_txt",
    subject: where,
    // llms.txt is the map an engine is meant to find; llms-full.txt is an optional
    // companion that far fewer sites publish. Grading its absence as a failure would
    // make almost every domain fail, and `fail` has to keep meaning "there is work here".
    status: r.present ? "pass" : isMap ? "fail" : "warn",
    summary: r.present
      ? `${file} on ${where}: ${kb(r.bytes)}, ${r.links} links`
      : `no ${file} on ${where} (HTTP ${r.status})`,
    detail: { ...r },
  };
}

function robotsFindings(target: string, r: RobotsResult): Finding[] {
  const out: Finding[] = r.present
    ? Object.entries(r.bots).map(([bot, v]) => ({
        target,
        check: "robots_bot",
        subject: bot,
        // A blocked training bot is a choice; a blocked retrieval bot is a visibility bug.
        status: v.verdict === "BLOCKED" ? (RETRIEVAL_BOTS.has(bot) ? "fail" : "warn") : "pass",
        summary: `${bot}: ${v.verdict}`,
        detail: { ...v, retrieval: RETRIEVAL_BOTS.has(bot) },
      }))
    : [{
        target,
        check: "robots_bot",
        subject: "",
        // "No robots.txt" means every bot is allowed. "Could not fetch robots.txt" means
        // nothing at all, and must not be reported as the permissive case.
        status: r.error ? "unknown" : "warn",
        summary: r.error
          ? `could not reach robots.txt: ${r.error}`
          : `no robots.txt (HTTP ${r.status}) — every bot is allowed by default`,
        detail: { url: r.url, status: r.status, ...(r.error ? { error: r.error } : {}) },
      }];

  // Emitted even when robots.txt is missing: a site with no robots.txt declares no
  // sitemap either, and a check that disappears from the report reads as a check that
  // passed. Every check a domain is subject to produces exactly one row.
  out.push({
    target,
    check: "sitemap",
    subject: "",
    status: r.sitemaps.length ? "pass" : r.error ? "unknown" : "warn",
    summary: r.sitemaps.length
      ? `${r.sitemaps.length} sitemap(s) declared`
      : r.error
        ? `could not reach robots.txt: ${r.error}`
        : r.present
          ? "no sitemap declared in robots.txt"
          : "no sitemap: robots.txt is missing",
    detail: { sitemaps: r.sitemaps, robotsPresent: r.present, ...(r.error ? { error: r.error } : {}) },
  });
  return out;
}

function structuredFinding(target: string, r: StructuredResult): Finding {
  if (r.error) {
    return {
      target,
      check: "json_ld",
      subject: "",
      status: "unknown",
      summary: `could not reach the homepage: ${r.error}`,
      detail: { ...r },
    };
  }
  return {
    target,
    check: "json_ld",
    subject: "",
    status: r.blocks ? "pass" : "warn",
    summary: r.blocks
      ? `${r.blocks} JSON-LD block(s): ${r.types.join(", ") || "untyped"}`
      : `no JSON-LD on the homepage (HTTP ${r.status})`,
    detail: { ...r },
  };
}

/** Audits one domain. Every check is independent, so they run together. */
export async function auditDomain(d: Domain, get: Fetcher = httpFetcher): Promise<Finding[]> {
  const [siteTxt, siteFull, robots, structured, docsTxt, docsFull] = await Promise.all([
    checkLlms(d.site, "llms.txt", get),
    checkLlms(d.site, "llms-full.txt", get),
    checkRobots(d.site, get),
    checkStructuredData(d.site, get),
    d.docs ? checkLlms(d.docs, "llms.txt", get) : Promise.resolve(null),
    d.docs ? checkLlms(d.docs, "llms-full.txt", get) : Promise.resolve(null),
  ]);

  const findings = [
    llmsFinding(d.label, "site", "llms.txt", siteTxt),
    llmsFinding(d.label, "site", "llms-full.txt", siteFull),
    ...robotsFindings(d.label, robots),
    structuredFinding(d.label, structured),
  ];
  if (docsTxt) findings.push(llmsFinding(d.label, "docs", "llms.txt", docsTxt));
  if (docsFull) findings.push(llmsFinding(d.label, "docs", "llms-full.txt", docsFull));
  return findings;
}

/** Audits every domain on a project. Domains are independent; failures stay local. */
export async function auditDomains(domains: Domain[], get: Fetcher = httpFetcher): Promise<Finding[]> {
  const per = await Promise.all(domains.map((d) => auditDomain(d, get)));
  return per.flat();
}
