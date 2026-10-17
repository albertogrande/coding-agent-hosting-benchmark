/**
 * The smoke gate: the first few runs of a season, read against the pins and against the
 * season before, before the rest of the night is committed.
 *
 * Wave 3 restarted after seven runs because agents skipped running the app on the wrong
 * Python, and someone noticed by reading closing messages forty minutes in. This is that
 * reading, written down so it happens every time and on every pin.
 *
 * Pure over stored runs; nothing here reads a store or calls a model.
 */

export type SmokeRun = {
  runId: number;
  status: string;
  modelResolved: string | null;
  toolVersion: string | null;
  account: string | null;
  text: string | null;
  /** The stored stream-json transcript. */
  stdout: string;
  /** What the runner recorded about the sandbox, from the raw record. */
  sandbox: { digest?: string | null; effort?: string | null } | null;
};

export type SmokePins = { model: string; claudeVersion: string; digest: string; effort: string };

export type SmokeFinding = { level: "fail" | "warn" | "pass"; check: string; detail: string };

/** Phrases a closing message uses when it skipped running the app for want of a tool. */
export const SKIP_PHRASES = [
  "could not install", "couldn't install", "unable to install", "not installed", "command not found",
  "requires python", "python 3.11", "no such file or directory", "could not run", "couldn't run",
  "unable to run", "skipped running", "did not run the app", "without running",
];

function lines(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const l of stdout.split("\n")) {
    const t = l.trim();
    if (!t.startsWith("{")) continue;
    try { out.push(JSON.parse(t) as Record<string, unknown>); } catch { /* not JSON */ }
  }
  return out;
}

/** Thinking tokens the main model spent on the run, from the closing result line. */
export function thinkingTokens(stdout: string, model: string): number | null {
  const result = lines(stdout).reverse().find((e) => e.type === "result");
  if (!result) return null;
  const mu = result.modelUsage as Record<string, { thinkingTokens?: number }> | undefined;
  if (mu?.[model] && typeof mu[model].thinkingTokens === "number") return mu[model].thinkingTokens!;
  const details = (result.usage as { output_tokens_details?: { thinking_tokens?: number } } | undefined)?.output_tokens_details;
  return typeof details?.thinking_tokens === "number" ? details.thinking_tokens : null;
}

/** The CLI's own inventory at startup: what tools, skills and agents a run was given. */
export function initInventory(stdout: string): { tools: string[]; skills: string[]; agents: string[] } | null {
  const init = lines(stdout).find((e) => e.type === "system" && e.subtype === "init");
  if (!init) return null;
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String((x as { name?: string })?.name ?? ""))).sort() : []);
  return { tools: names(init.tools), skills: names(init.skills), agents: names(init.agents) };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

export function smokeFindings(runs: SmokeRun[], pins: SmokePins, baseline: { thinking: number[]; inventory: ReturnType<typeof initInventory> }): SmokeFinding[] {
  const out: SmokeFinding[] = [];
  const stored = runs.filter((r) => r.status !== "error");
  const bare = (d: string) => d.replace(/^sha256:/, "");

  out.push(stored.length
    ? { level: "pass", check: "runs stored", detail: `${stored.length} stored, ${runs.length - stored.length} error rows` }
    : { level: "fail", check: "runs stored", detail: "no run was stored" });

  const wrongModel = stored.filter((r) => (r.modelResolved ?? "").replace(/-\d{8}$/, "") !== pins.model);
  out.push(wrongModel.length
    ? { level: "fail", check: "model served", detail: wrongModel.map((r) => `run ${r.runId}: ${r.modelResolved}`).join("; ") }
    : { level: "pass", check: "model served", detail: `${pins.model} on every run` });

  const wrongCli = stored.filter((r) => !(r.toolVersion ?? "").startsWith(pins.claudeVersion));
  out.push(wrongCli.length
    ? { level: "fail", check: "CLI release", detail: wrongCli.map((r) => `run ${r.runId}: ${r.toolVersion}`).join("; ") }
    : { level: "pass", check: "CLI release", detail: `${pins.claudeVersion} on every run` });

  const wrongImage = stored.filter((r) => !bare(r.sandbox?.digest ?? "").startsWith(bare(pins.digest)) ||
    !(r.account ?? "").includes(`@${bare(pins.digest).slice(0, 12)}`));
  out.push(wrongImage.length
    ? { level: "fail", check: "image digest", detail: wrongImage.map((r) => `run ${r.runId}: ${r.sandbox?.digest ?? "none"} / ${r.account}`).join("; ") }
    : { level: "pass", check: "image digest", detail: `${bare(pins.digest).slice(0, 12)} on every run and its stamp` });

  const wrongEffort = stored.filter((r) => r.sandbox?.effort !== pins.effort);
  out.push(wrongEffort.length
    ? { level: "fail", check: "effort recorded", detail: wrongEffort.map((r) => `run ${r.runId}: ${r.sandbox?.effort ?? "none"}`).join("; ") }
    : { level: "pass", check: "effort recorded", detail: `${pins.effort} on every run` });

  const thinking = stored.map((r) => thinkingTokens(r.stdout, pins.model)).filter((x): x is number => x !== null);
  const lo = Math.min(...baseline.thinking), hi = Math.max(...baseline.thinking);
  const outside = thinking.filter((t) => t < lo || t > hi);
  const detail = `median ${median(thinking) ?? "?"} against season 0's ${median(baseline.thinking) ?? "?"} (range ${lo} to ${hi})`;
  out.push(!thinking.length
    ? { level: "fail", check: "thinking tokens", detail: "no run reported thinking tokens" }
    : outside.length
      ? { level: "warn", check: "thinking tokens", detail: `${outside.length} run(s) outside season 0's range · ${detail}` }
      : { level: "pass", check: "thinking tokens", detail });

  const skips = stored.flatMap((r) => {
    const t = (r.text ?? "").toLowerCase();
    return SKIP_PHRASES.filter((p) => t.includes(p)).map((p) => `run ${r.runId}: "${p}"`);
  });
  out.push(skips.length
    ? { level: "warn", check: "closing messages", detail: `read these before going on: ${skips.join("; ")}` }
    : { level: "pass", check: "closing messages", detail: "no run says it could not install or run something" });

  const inv = stored.map((r) => initInventory(r.stdout)).find(Boolean) ?? null;
  if (!inv || !baseline.inventory) {
    out.push({ level: "warn", check: "CLI inventory", detail: "no init line to compare" });
  } else {
    const diff = (k: "tools" | "skills" | "agents") => {
      const a = new Set(baseline.inventory![k]), b = new Set(inv[k]);
      const added = [...b].filter((x) => !a.has(x)), removed = [...a].filter((x) => !b.has(x));
      return added.length || removed.length ? `${k}: +${added.join(",") || "none"} -${removed.join(",") || "none"}` : null;
    };
    const diffs = (["tools", "skills", "agents"] as const).map(diff).filter(Boolean);
    out.push(diffs.length
      ? { level: "warn", check: "CLI inventory", detail: `differs from season 0, write it down: ${diffs.join(" · ")}` }
      : { level: "pass", check: "CLI inventory", detail: `same ${inv.tools.length} tools, ${inv.skills.length} skills, ${inv.agents.length} agents as season 0` });
  }
  return out;
}
