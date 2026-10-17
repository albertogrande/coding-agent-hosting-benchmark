/**
 * The checks a wave should survive before anyone commits a night to it.
 *
 * This half is pure: it reads a project, a prompt set and a planned wave, and says what is
 * wrong with the design. The half that needs a machine — a logged-in CLI, a cloneable
 * repository, disk — lives in `src/runner/preflight.ts`, because it cannot run in a test.
 *
 * A check that could not run reports `unknown`. It is never folded into `pass`, and never
 * into `fail`: "we could not tell" and "it is broken" lead to different decisions at 11pm,
 * and the first live audit caught a timeout that would otherwise have shipped as a finding.
 */
import type { Alias } from "@/db/schema";
import { isAgentSurface, isKnownSurface } from "@/lib/surfaces";
import { namedEntrants } from "./benchmark";

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

export type Check = {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
};

export type PlannedSurfaceView = {
  surfaceKey: string;
  label: string;
  modelRequested: string | null;
  reps: number;
  config: Record<string, unknown>;
  cells: number;
};

export type DesignInput = {
  project: { name: string; platforms: Alias[] };
  prompts: { key: string; text: string }[];
  surfaces: PlannedSurfaceView[];
  /** Set when this wave is meant to produce a published league table. */
  forBenchmark?: boolean;
};

const pass = (name: string, detail: string): Check => ({ name, status: "pass", detail });
const warn = (name: string, detail: string, fix?: string): Check => ({ name, status: "warn", detail, fix });
const fail = (name: string, detail: string, fix?: string): Check => ({ name, status: "fail", detail, fix });

/** True when nothing in the list should stop a wave from starting. */
export const clearToRun = (checks: Check[]): boolean => !checks.some((c) => c.status === "fail");

export function checkDesign(input: DesignInput): Check[] {
  const { project, prompts, surfaces } = input;
  const checks: Check[] = [];
  const platforms = project.platforms;

  // --- prompts -----------------------------------------------------------------
  checks.push(prompts.length
    ? pass("prompt set", `${prompts.length} prompts`)
    : fail("prompt set", "the wave's prompt set is empty", "import a prompt set before planning"));

  const branded = namedEntrants(prompts, platforms);
  if (input.forBenchmark) {
    checks.push(branded.length
      ? fail(
          "prompts name no entrant",
          `${branded.length} prompt(s) name a platform: ${branded.slice(0, 3).map((b) => `${b.key} (${b.platform})`).join(", ")}` +
            (branded.length > 3 ? `, and ${branded.length - 3} more` : ""),
          "a named platform is guaranteed to appear in the answer — drop those prompts or drop the benchmark",
        )
      : pass("prompts name no entrant", "no prompt names a platform under measurement"));
  } else if (branded.length) {
    checks.push(warn(
      "prompts name an entrant",
      `${branded.length} prompt(s) name a platform, which is fine for a brand study and fatal for a benchmark`,
      "exclude them if this wave will ever be published as a league table",
    ));
  }

  // --- ownership ---------------------------------------------------------------
  // Without declared domains every cited page classifies as third-party, so the citation
  // figures come out as a confident row of zeros rather than as obviously missing.
  const noDomains = platforms.filter((p) => !(p.domains ?? []).length);
  checks.push(noDomains.length === platforms.length
    ? fail(
        "ownership domains",
        "no platform declares any domains, so every cited page will classify as third-party",
        "add domains to the platforms before running, or citation ownership is unmeasurable for this wave",
      )
    : noDomains.length
      ? warn(
          "ownership domains",
          `${noDomains.length} platform(s) declare no domains: ${noDomains.map((p) => p.name).join(", ")}`,
          "their pages will count as third-party rather than as their own",
        )
      : pass("ownership domains", `all ${platforms.length} platforms declare domains`));

  // --- surfaces ----------------------------------------------------------------
  if (!surfaces.length) {
    checks.push(fail("surfaces", "the wave has no surfaces", "plan at least one"));
    return checks;
  }

  const unknown = surfaces.filter((s) => !isKnownSurface(s.surfaceKey));
  checks.push(unknown.length
    ? fail("surfaces are runnable", `unknown surface key(s): ${unknown.map((s) => s.surfaceKey).join(", ")}`)
    : pass("surfaces are runnable", surfaces.map((s) => s.label).join(", ")));

  const reps = [...new Set(surfaces.map((s) => s.reps))];
  checks.push(reps.length === 1
    ? pass("repeats are even", `${reps[0]} per cell on every surface`)
    : warn(
        "repeats are even",
        `uneven: ${surfaces.map((s) => `${s.label} ${s.reps}`).join(", ")}`,
        "each surface's interval will be a different width; make sure that was the intent",
      ));

  // A single run per cell can never disagree with itself, so the instrument's own variance
  // is unmeasurable and every difference the wave produces has to be called insufficient.
  const single = surfaces.filter((s) => s.reps < 2);
  checks.push(single.length
    ? warn(
        "repeats allow a noise floor",
        `${single.map((s) => s.label).join(", ")} run once per cell`,
        "with no repeat there is nothing to measure variance against, and no difference from this wave can be called real",
      )
    : pass("repeats allow a noise floor", `every surface repeats at least twice`));

  // --- output budget -----------------------------------------------------------
  // The defect that voided a third of one engine's answers was a number nobody chose.
  for (const s of surfaces) {
    const cap = s.config.maxOutputTokens;
    if (typeof cap === "number" && cap < 4096) {
      checks.push(warn(
        `output budget · ${s.label}`,
        `capped at ${cap} tokens`,
        "a 2048-token ceiling truncated 34% of one engine's answers in the imported wave; each one is voided, not graded",
      ));
    }
  }

  // --- agent surfaces ----------------------------------------------------------
  for (const s of surfaces.filter((x) => isAgentSurface(x.surfaceKey))) {
    const targets = Array.isArray(s.config.targets) ? (s.config.targets as { id: string }[]) : [];
    checks.push(targets.length
      ? pass(`targets · ${s.label}`, `${targets.length} repositories`)
      : fail(`targets · ${s.label}`, "an agent surface with no repositories has nothing to run against"));
  }

  checks.push(pass("wave size", `${surfaces.reduce((n, s) => n + s.cells * s.reps, 0)} runs across ${surfaces.length} surface(s)`));
  return checks;
}
