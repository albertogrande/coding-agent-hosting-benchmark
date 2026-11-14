/**
 * Counts of the email labels per network condition, for the terminal and the labels file.
 * Counts, never shares: a cell of three runs has no interval worth printing here.
 */
import type { EmailLabels } from "./labels";

export type LabelledRun = {
  runId: number;
  target: string;
  brief: string;
  surface: string;
  condition: string;
  model: string | null;
  rep: number;
  status: string;
  labels: EmailLabels | null;
  /** The reviewed pick when a reviewer recorded one, else the script's. */
  final: string | null;
  reviewed: boolean;
  judge?: { picked: string; model: string };
};

export type ConditionSummary = {
  graded: number;
  voided: number;
  picked: Record<string, number>;
  decided: Record<string, number>;
  read: Record<string, number>;
  stopped: Record<string, number>;
  compiles: Record<string, number>;
  templates: Record<string, number>;
  surfaceUsed: Record<string, number>;
  cost: Record<string, number>;
  refused: Record<string, number>;
};

const bump = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };

export function summarise(runs: LabelledRun[]): Record<string, ConditionSummary> {
  const out: Record<string, ConditionSummary> = {};
  for (const r of runs) {
    const s = (out[r.condition] = out[r.condition] ?? {
      graded: 0, voided: 0, picked: {}, decided: {}, read: {}, stopped: {}, compiles: {}, templates: {}, surfaceUsed: {}, cost: {}, refused: {},
    });
    const l = r.labels;
    if (!l) { s.voided += 1; continue; }
    s.graded += 1;
    bump(s.picked, r.final ?? "none");
    bump(s.decided, l.decided.mode);
    if (l.read.urls.length) bump(s.read, "opened a page");
    if (l.read.owned) bump(s.read, "opened an owned page");
    if (l.read.flags.llmsTxt) bump(s.read, "llms.txt");
    if (l.read.flags.md) bump(s.read, ".md");
    if (l.read.flags.pricingMd) bump(s.read, "pricing.md");
    if (l.read.flags.acceptMarkdown) bump(s.read, "Accept: text/markdown");
    bump(s.stopped, l.stopped.at);
    bump(s.compiles, l.compiles.status);
    bump(s.templates, l.templates ? "React Email" : "none");
    for (const u of l.surfaceUsed.used) bump(s.surfaceUsed, `used ${u}`);
    for (const m of l.surfaceUsed.mentioned) bump(s.surfaceUsed, `mentioned ${m}`);
    if (l.cost) bump(s.cost, l.cost.resendRight === null ? "no Resend figure" : l.cost.resendRight ? "Resend figure right" : "Resend figure wrong");
    for (const [rule, n] of Object.entries(l.network?.refused ?? {})) bump(s.refused, rule, n);
  }
  return out;
}
