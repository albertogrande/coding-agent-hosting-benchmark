/**
 * The email project's labels, read from what a stored session left: the manifests before and
 * after, the files it touched, the transcript, the egress log, and the compile check.
 *
 * Script first, as in the hosting study. Every label carries the evidence it was read from, and
 * `unsure` lists what a model's second look should settle. Nothing here calls a model.
 *
 *   picked       the provider whose package was added to the manifest; failing that, the one
 *                whose SDK is imported; failing that, the one named in the last message.
 *                `diy` for SMTP or a framework mailer with no provider; `incumbent` when it
 *                kept what the app already had.
 *   decided      memory, search, fetch or shell, counted before the first install or import.
 *   read         every URL opened, classed owned / third-party / community, with flags for
 *                llms.txt, .md and pricing.md.
 *   named        every provider its messages mention.
 *   templates    React Email used or not.
 *   stopped      where the session ended.
 *   surfaceUsed  the provider's MCP, CLI, skills or plugin, reached for or mentioned.
 *   compiles     the post-run check, as stored.
 *   cost         on the cost brief, the monthly figure quoted for each provider.
 */
import { decisionMode } from "@/derive/adoption";
import { shellLookups, shellReads } from "@/derive/shell-lookups";
import {
  CLOUDFLARE_SIGNS, GENERIC_SDKS, PACKAGES, PROVIDERS, PY_MODULES, REACT_EMAIL, RUBY_SIGNS, SMTP_HOSTS,
  VENDOR_PATTERNS, domainClass, hostOf, type DomainClass,
} from "./vendors";
import { scaffoldOf } from "./scaffolds";
import { callsFromTimeline, readTranscript, type ToolCall } from "./transcript";

export type Manifest = { path: string; before: string | null; after: string | null };
export type FileBody = { path: string; body: string };
export type EgressEntry = {
  method: string;
  host: string;
  path?: string;
  decision: string;
  rule: string;
  status?: number;
};
export type CompileResult = {
  status: "pass" | "fail" | "not-run" | "n/a";
  tool: string;
  detail: string;
};

export type EmailRunInput = {
  target: string;
  promptKey: string;
  /** Every assistant text block, joined, as the run stores it. */
  text: string | null;
  /** The raw `stream-json` transcript, when stored. */
  stdout?: string | null;
  toolTimeline?: { seq: number; tool: string; detail?: string }[];
  changedFiles?: string[];
  fileBodies?: FileBody[];
  manifests?: Manifest[];
  egress?: EgressEntry[];
  compile?: CompileResult | null;
};

// ------------------------------------------------------------------ manifests

const MANIFEST = /(^|\/)(package\.json|requirements[\w.-]*\.txt|pyproject\.toml|Gemfile)$/;
export const isManifest = (p: string) => MANIFEST.test(p);

/** Dependency names a manifest declares, lowercased. Tolerant: a file that will not parse yields none. */
export function manifestDeps(path: string, body: string | null): string[] {
  if (!body) return [];
  const name = path.split("/").pop() ?? "";
  if (name === "package.json") {
    try {
      const j = JSON.parse(body) as Record<string, Record<string, string> | undefined>;
      return [...new Set(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
        .flatMap((k) => Object.keys(j[k] ?? {})).map((d) => d.toLowerCase()))];
    } catch {
      return [];
    }
  }
  if (name === "Gemfile") {
    return [...body.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1].toLowerCase());
  }
  if (name.startsWith("requirements")) {
    return body.split("\n").map((l) => l.replace(/#.*/, "").trim())
      .filter((l) => l && !l.startsWith("-"))
      .map((l) => l.split(/[\s<>=!~;\[]/)[0].toLowerCase()).filter(Boolean);
  }
  if (name === "pyproject.toml") {
    const out = new Set<string>();
    // PEP 621 arrays and poetry tables, read loosely: a quoted requirement, or a key in a
    // [tool.poetry.dependencies] table.
    for (const m of body.matchAll(/dependencies\s*=\s*\[([\s\S]*?)\]/g)) {
      for (const q of m[1].matchAll(/["']([A-Za-z0-9_.-]+)/g)) out.add(q[1].toLowerCase());
    }
    for (const m of body.matchAll(/\[tool\.poetry\.(?:group\.\w+\.)?dependencies\]([\s\S]*?)(?=\n\[|$)/g)) {
      for (const k of m[1].matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)) if (k[1] !== "python") out.add(k[1].toLowerCase());
    }
    return [...out];
  }
  return [];
}

/** What every manifest gained between the clone and the end of the run. */
export function addedDeps(manifests: Manifest[]): string[] {
  const out: string[] = [];
  for (const m of manifests) {
    const before = new Set(manifestDeps(m.path, m.before));
    for (const d of manifestDeps(m.path, m.after)) if (!before.has(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

// ------------------------------------------------------------------ code

const CODE = /\.(m?[jt]sx?|cjs|py|rb|erb|toml|jsonc?|ya?ml|env[\w.-]*)$|(^|\/)\.env[\w.-]*$/i;
const SKIP = /(^|\/)(node_modules|\.next|dist|\.venv|vendor)\/|\.(lock|md)$|package-lock\.json$/i;

/** Module specifiers a JavaScript or TypeScript file imports or requires. */
function jsModules(body: string): string[] {
  return [
    ...body.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...body.matchAll(/\bimport\s*\(\s*(?:\/\*[^*]*\*\/\s*)?["']([^"']+)["']\s*\)/g),
    ...body.matchAll(/\bimport\s+["']([^"']+)["']/g),
    ...body.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
}

/** The package a JavaScript specifier belongs to: `@scope/name/sub` is `@scope/name`. */
function jsPackage(spec: string): string {
  const parts = spec.split("/");
  return (spec.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/").toLowerCase();
}

function pyModules(body: string): string[] {
  return [
    ...body.matchAll(/^\s*import\s+([\w.]+)/gm),
    ...body.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm),
  ].map((m) => m[1].split(".")[0]);
}

export type CodeSigns = { vendors: string[]; smtp: string[]; templates: boolean };

/** Which providers a piece of code uses, by import, SDK sign, relay host or binding. */
export function codeSigns(path: string, body: string): CodeSigns {
  const vendors: string[] = [];
  const add = (v: string | undefined) => { if (v && !vendors.includes(v)) vendors.push(v); };
  let templates = false;
  if (/\.(m?[jt]sx?|cjs)$/i.test(path)) {
    for (const spec of jsModules(body)) {
      if (spec === "cloudflare:email") { add("cloudflare"); continue; }
      const pkg = jsPackage(spec);
      if (REACT_EMAIL.test(pkg)) templates = true;
      add(PACKAGES[pkg]);
      if (GENERIC_SDKS[pkg]?.when.test(body)) add(GENERIC_SDKS[pkg].vendor);
    }
  } else if (/\.py$/i.test(path)) {
    for (const mod of pyModules(body)) {
      add(PY_MODULES[mod]);
      if (GENERIC_SDKS[mod]?.when.test(body)) add(GENERIC_SDKS[mod].vendor);
    }
  } else if (/\.(rb|erb)$/i.test(path)) {
    for (const [re, v] of RUBY_SIGNS) if (re.test(body)) add(v);
  }
  if (CLOUDFLARE_SIGNS.test(body)) add("cloudflare");
  const smtp = SMTP_HOSTS.filter(([re]) => re.test(body)).map(([, v]) => v);
  return { vendors, smtp: [...new Set(smtp)], templates };
}

// ------------------------------------------------------------------ named

/** Every provider the messages name, in order of first appearance. */
export function named(text: string): string[] {
  return PROVIDERS
    .map((v) => ({ v, at: text.search(VENDOR_PATTERNS[v]) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.v);
}

// ------------------------------------------------------------------ picked

export type Picked = {
  value: string | null;
  source: "manifest" | "import" | "last-message" | "none";
  evidence: string[];
  conflict: string | null;
};

const DECIDING = /\b(?:chose|chosen|choosing|picked|selected|went with|going with|settled on|opted for|use[sd]?|using|integrat\w*|switch\w* to|added|installed|recommend\w*)\b/i;

/** The provider the closing message decides on: the one beside a deciding verb, else the only one named. */
export function stateChoice(lastMessage: string): string | null {
  for (const sentence of lastMessage.split(/(?<=[.!?])\s+|\n/).reverse()) {
    if (!DECIDING.test(sentence)) continue;
    const here = named(sentence);
    if (here.length) return here[0];
  }
  const all = named(lastMessage);
  return all.length === 1 ? all[0] : null;
}

/**
 * A provider when the code says which one, else `diy` when the code sends with SMTP or the
 * framework's mailer and names no relay, else null.
 */
function resolve(vendors: string[], smtp: string[]): { value: string | null; others: string[] } {
  const providers = vendors.filter((v) => v !== "diy");
  if (providers.length) return { value: providers[0], others: providers.slice(1) };
  if (smtp.length) return { value: smtp[0], others: smtp.slice(1) };
  return { value: vendors.includes("diy") ? "diy" : null, others: [] };
}

export function picked(input: EmailRunInput, lastMessage: string): Picked {
  const evidence: string[] = [];
  const bodies = (input.fileBodies ?? []).filter((b) => CODE.test(b.path) && !SKIP.test(b.path));
  const signs = bodies.map((b) => ({ path: b.path, ...codeSigns(b.path, b.body) }));
  const smtp = [...new Set(signs.flatMap((s) => s.smtp))];
  const imported = [...new Set(signs.flatMap((s) => s.vendors))];

  let out: Picked | null = null;

  // 1. The manifest diff.
  const added = addedDeps(input.manifests ?? []);
  const fromPkgs: string[] = [];
  for (const d of added) {
    const v = PACKAGES[d] ?? (GENERIC_SDKS[d] && bodies.some((b) => GENERIC_SDKS[d].when.test(b.body)) ? GENERIC_SDKS[d].vendor : undefined);
    if (v && !fromPkgs.includes(v)) fromPkgs.push(v);
  }
  if (fromPkgs.length) {
    evidence.push(`manifest added: ${added.filter((d) => PACKAGES[d] || GENERIC_SDKS[d]).join(", ")}`);
    const r = resolve(fromPkgs, smtp);
    // Two providers added: the one the code also imports is the one in use.
    const both = fromPkgs.filter((v) => v !== "diy" && imported.includes(v));
    const value = both[0] ?? r.value;
    out = {
      value, source: "manifest", evidence,
      conflict: r.others.length ? `manifest adds ${fromPkgs.filter((v) => v !== "diy").join(" and ")}` : null,
    };
  }

  // 2. The imports in the files it touched.
  if (!out) {
    const r = resolve(imported, smtp);
    if (r.value) {
      const where = signs.filter((s) => s.vendors.length || s.smtp.length).map((s) => `${s.path} (${[...s.vendors, ...s.smtp].join(", ")})`);
      evidence.push(`code: ${where.slice(0, 5).join("; ")}`);
      out = { value: r.value, source: "import", evidence, conflict: r.others.length ? `code uses ${[r.value, ...r.others].join(" and ")}` : null };
    }
  }

  // 3. The last message.
  if (!out) {
    const said = stateChoice(lastMessage);
    if (said) {
      evidence.push(`last message: ${said}`);
      out = { value: said, source: "last-message", evidence, conflict: null };
    }
  }
  if (!out) return { value: null, source: "none", evidence: ["nothing in the manifests, the code or the last message names a provider"], conflict: null };

  // Kept what was there: the incumbent arm's question.
  const incumbent = scaffoldOf(input.target)?.incumbent;
  if (incumbent && out.value === incumbent) {
    out.evidence.push(`${incumbent} is what ${input.target} already had`);
    out.value = "incumbent";
  }
  return out;
}

// ------------------------------------------------------------------ decided

const INSTALL = /\b(?:npm\s+(?:i|install|add)|pnpm\s+(?:i|install|add)|yarn\s+add|bun\s+(?:i|install|add)|pip3?\s+install|python3?\s+-m\s+pip\s+install|uv\s+(?:add|pip\s+install)|poetry\s+add|bundle\s+add|gem\s+install)\b/;

/** True when a call commits to a way of sending: installs a provider or mail library, or writes code that imports one. */
export function commits(call: ToolCall): boolean {
  if (call.tool === "Bash") {
    if (!INSTALL.test(call.detail)) return false;
    const tokens = call.detail.split(/[\s'"]+/).map((t) => t.replace(/@[\d^~<>=.*x-]+$/, "").replace(/[<>=~!].*$/, "").toLowerCase());
    return tokens.some((t) => PACKAGES[t] || GENERIC_SDKS[t] || REACT_EMAIL.test(t));
  }
  if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(call.tool) || !call.written) return false;
  if (isManifest(call.detail)) {
    if (manifestDeps(call.detail, call.written).some((d) => PACKAGES[d] || GENERIC_SDKS[d])) return true;
    // A fragment of a package.json or a Gemfile line: read the names off it directly.
    return Object.keys(PACKAGES).some((p) => new RegExp(`["'\\s]${p.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["'\\s=<>~]`).test(` ${call.written} `));
  }
  const s = codeSigns(call.detail, call.written);
  return s.vendors.length > 0 || s.smtp.length > 0;
}

export type Decided = {
  mode: "memory" | "search" | "fetch" | "shell";
  /** The call that committed, or null when none did and the whole run was counted. */
  commitSeq: number | null;
  before: { searches: number; fetches: number; shellLookups: number };
};

/**
 * The hosting project's decision mode (`decisionMode` in `src/derive/adoption.ts`, which counts
 * shell reads since stance-5), counted over the calls before the first install or import.
 * Its `prior` is this project's `memory`.
 */
export function decided(calls: ToolCall[]): Decided {
  const at = calls.findIndex(commits);
  const prefix = at === -1 ? calls : calls.slice(0, at);
  const before = {
    searches: prefix.filter((c) => c.tool === "WebSearch").length,
    fetches: prefix.filter((c) => c.tool === "WebFetch").length,
    shellLookups: shellLookups(prefix.filter((c) => c.tool === "Bash").map((c) => c.detail)).length,
  };
  const mode = decisionMode(before);
  return { mode: mode === "prior" ? "memory" : mode, commitSeq: at === -1 ? null : calls[at].seq, before };
}

// ------------------------------------------------------------------ read

export type MachineFile = "llms.txt" | "pricing.md" | "md" | "accept-markdown";
export type ReadUrl = { url: string; host: string | null; via: "fetch" | "shell"; class: DomainClass; machine: MachineFile | null };
export type Read = {
  urls: ReadUrl[];
  owned: number;
  thirdParty: number;
  community: number;
  flags: { llmsTxt: boolean; md: boolean; pricingMd: boolean; acceptMarkdown: boolean };
};

export function machineFile(url: string): MachineFile | null {
  const path = url.replace(/[?#].*$/, "");
  if (/\/llms(-full)?\.txt$/i.test(path)) return "llms.txt";
  if (/\/pricing\.md$/i.test(path)) return "pricing.md";
  if (/\.mdx?$/i.test(path)) return "md";
  return null;
}

export function read(calls: ToolCall[]): Read {
  const urls: ReadUrl[] = [];
  const seen = new Set<string>();
  const push = (url: string, via: ReadUrl["via"], accept = false) => {
    if (seen.has(url)) return;
    seen.add(url);
    const host = hostOf(url);
    urls.push({ url, host, via, class: domainClass(host), machine: machineFile(url) ?? (accept ? "accept-markdown" : null) });
  };
  for (const c of calls) {
    if (c.tool === "WebFetch" && c.detail) push(c.detail, "fetch");
    if (c.tool === "Bash") {
      const accept = /accept:\s*text\/markdown/i.test(c.detail);
      for (const r of shellReads(c.detail)) if (r.kind === "lookup") push(r.url, "shell", accept);
    }
  }
  return {
    urls,
    owned: urls.filter((u) => u.class.startsWith("owned:")).length,
    thirdParty: urls.filter((u) => u.class === "third-party").length,
    community: urls.filter((u) => u.class === "community").length,
    flags: {
      llmsTxt: urls.some((u) => u.machine === "llms.txt"),
      md: urls.some((u) => u.machine === "md" || u.machine === "pricing.md"),
      pricingMd: urls.some((u) => u.machine === "pricing.md"),
      acceptMarkdown: urls.some((u) => u.machine === "accept-markdown"),
    },
  };
}

/**
 * What the egress proxy saw, for the network conditions: every host the run reached beyond the
 * CLI's own, and every request it refused, by rule. A condition that refused nothing did not
 * test anything, and this is where that shows.
 */
export function network(egress: EgressEntry[] | undefined): { hosts: string[]; refused: Record<string, number>; machineRefused: number } | null {
  if (!egress) return null;
  const own = /(^|\.)(anthropic\.com|claude\.ai|claude\.com)$/;
  const hosts = [...new Set(egress.map((e) => e.host).filter((h) => h && !own.test(h)))];
  const refused: Record<string, number> = {};
  for (const e of egress) if (e.decision === "refuse") refused[e.rule] = (refused[e.rule] ?? 0) + 1;
  return { hosts, refused, machineRefused: (refused["machine-file"] ?? 0) + (refused["markdown-response"] ?? 0) };
}

// ------------------------------------------------------------------ templates, stopped, surface

/** React Email used: added to a manifest, installed, or imported. */
export function templates(input: EmailRunInput, calls: ToolCall[]): boolean {
  if (addedDeps(input.manifests ?? []).some((d) => REACT_EMAIL.test(d))) return true;
  if ((input.fileBodies ?? []).some((b) => !SKIP.test(b.path) && codeSigns(b.path, b.body).templates)) return true;
  return calls.some((c) => (c.tool === "Bash" && INSTALL.test(c.detail) && /(^|\s)(react-email|@react-email\/)/.test(c.detail))
    || (c.written !== "" && codeSigns(c.detail, c.written).templates));
}

export type Stopped = { at: "dns" | "domain" | "api-key" | "finished"; dns: boolean; domain: boolean; apiKey: boolean };

const DNS = /\b(SPF|DKIM|DMARC|MX records?|TXT records?|CNAME records?|DNS records?|DNS settings)\b/i;
const DOMAIN = /\b(verif\w*)\b[^.\n]{0,50}\bdomain\b|\bdomain\b[^.\n]{0,50}\bverif\w*|\bsending domain\b|\bfrom (address|domain)\b/i;
const API_KEY = /\bAPI[_ -]?keys?\b|_API_KEY\b|\bapi[_ -]?token\b/i;

/**
 * Where the session ended, read off its closing message. The most specific thing it left the
 * user to do wins: DNS instructions over a domain to verify over a key to set.
 */
export function stopped(lastMessage: string): Stopped {
  const dns = DNS.test(lastMessage);
  const domain = DOMAIN.test(lastMessage);
  const apiKey = API_KEY.test(lastMessage);
  return { at: dns ? "dns" : domain ? "domain" : apiKey ? "api-key" : "finished", dns, domain, apiKey };
}

export type SurfaceUsed = { used: string[]; mentioned: string[] };

const SURFACE_USE: [RegExp, string][] = [
  [/\bclaude\s+mcp\s+add\b[^\n]*resend|mcp\.resend\.com|resend[\w-]*mcp|mcp[\w-]*resend/i, "mcp"],
  [/\bnpx\s+(?:-y\s+)?resend(?:-cli)?\b|\bresend-cli\b|(?:^|[;&|]\s*)resend\s+(?:emails?|domains?|login|send|api-keys?|whoami)\b/i, "cli"],
  [/resend[\w/-]*skills?\b|skills?\s+add\b[^\n]*resend/i, "skills"],
  [/\bclaude\s+plugins?\b[^\n]*resend|\/plugin\b[^\n]*resend/i, "plugin"],
];

const SURFACE_MENTION: [RegExp, string][] = [
  [/\bresend\b[^.\n]{0,40}\bMCP\b|\bMCP\b[^.\n]{0,40}\bresend\b/i, "mcp"],
  [/\bresend\b[^.\n]{0,30}\bCLI\b|\bresend-cli\b/i, "cli"],
  [/\bresend\b[^.\n]{0,30}\bskills?\b|\bresend-skills\b/i, "skills"],
  [/\bresend\b[^.\n]{0,30}\bplugin\b|\bplugin\b[^.\n]{0,30}\bresend\b/i, "plugin"],
];

export function surfaceUsed(text: string, calls: ToolCall[]): SurfaceUsed {
  const reach = calls.filter((c) => c.tool === "Bash" || c.tool === "WebFetch" || c.tool.startsWith("mcp__")).map((c) => `${c.tool} ${c.detail}`);
  const used = SURFACE_USE.filter(([re]) => reach.some((r) => re.test(r))).map(([, k]) => k);
  if (calls.some((c) => /^mcp__.*resend/i.test(c.tool)) && !used.includes("mcp")) used.push("mcp");
  return { used, mentioned: SURFACE_MENTION.filter(([re]) => re.test(text)).map(([, k]) => k) };
}

// ------------------------------------------------------------------ cost

const DOLLARS = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k\b)?/gi;

/** Every dollar figure quoted beside each provider, in the order written. */
export function costQuoted(text: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const line of text.split("\n")) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const who = named(sentence)[0];
      if (!who) continue;
      for (const m of sentence.matchAll(DOLLARS)) {
        const v = Number(`${m[1].replace(/,/g, "")}.${m[2] ?? "0"}`) * (m[3] ? 1000 : 1);
        (out[who] = out[who] ?? []).push(v);
      }
    }
  }
  return out;
}

/** Whether a Resend figure in the accepted set was quoted: true, false, or null when none was. */
export function resendCostRight(quoted: Record<string, number[]>, accept: number[]): boolean | null {
  const figures = quoted.resend ?? [];
  if (!figures.length) return null;
  return figures.some((f) => accept.some((a) => Math.abs(f - a) <= 1));
}

// ------------------------------------------------------------------ all of them

export type EmailLabels = {
  picked: Picked;
  decided: Decided;
  read: Read;
  network: ReturnType<typeof network>;
  named: string[];
  templates: boolean;
  stopped: Stopped;
  surfaceUsed: SurfaceUsed;
  compiles: CompileResult;
  cost: { quoted: Record<string, number[]>; resendRight: boolean | null } | null;
  /** What the script could not settle, for the model's second look. */
  unsure: string[];
};

export function emailLabels(input: EmailRunInput, opts: { costAccept?: number[] } = {}): EmailLabels {
  const t = readTranscript(input.stdout);
  const calls = t.calls.length ? t.calls : callsFromTimeline(input.toolTimeline ?? []);
  const lastMessage = t.lastMessage || (input.text ?? "").trim().split(/\n{2,}/).slice(-3).join("\n\n");
  const text = input.text ?? "";

  const p = picked(input, lastMessage);
  const quoted = input.promptKey === "cost" ? costQuoted(text) : null;
  const unsure: string[] = [];
  if (!p.value) unsure.push("picked: nothing names a provider");
  if (p.conflict) unsure.push(`picked: ${p.conflict}`);
  if (p.source === "last-message") unsure.push("picked: read from the last message only");
  if (!t.calls.length) unsure.push("decided: no transcript stored, file contents unread");

  return {
    picked: p,
    decided: decided(calls),
    read: read(calls),
    network: network(input.egress),
    named: named(text),
    templates: templates(input, calls),
    stopped: stopped(lastMessage),
    surfaceUsed: surfaceUsed(text, calls),
    compiles: input.compile ?? { status: "not-run", tool: "", detail: "no compile check was stored for this run" },
    cost: quoted ? { quoted, resendRight: resendCostRight(quoted, opts.costAccept ?? []) } : null,
    unsure,
  };
}
