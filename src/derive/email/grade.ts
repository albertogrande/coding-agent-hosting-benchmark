/**
 * Grades an email session into the store's `grades` table, beside the hosting grades and never
 * among them: its own grader version, so `explorerRows`, the review queue and the funnel read it
 * with the same code and a different key.
 *
 * The table's columns take the labels that have a home there: `winner` is `picked`,
 * `platformsNamed` is `named`, `decisionMode` is `decided`. The rest of the labels are derived
 * again from the stored run whenever they are read (`scripts/email-labels.mts`), because the
 * grader is deterministic and the inputs are stored: a label nobody has to store cannot drift
 * from the rule that made it.
 */
import type { Grade } from "@/derive/grade";
import { emailLabels, type EmailLabels, type EmailRunInput } from "./labels";

/**
 * email-1 (2026-11-13): the first rules, registered in docs/EMAIL-PREREG.md before any
 * definitive wave.
 */
export const EMAIL_GRADER_VERSION = "email-1";

export type EmailGradeInput = EmailRunInput & { truncated?: boolean; status?: string };

export function gradeEmailRun(run: EmailGradeInput, opts: { costAccept?: number[] } = {}): { grade: Grade; labels: EmailLabels | null } {
  if (run.truncated || run.status === "error" || run.status === "voided") {
    return {
      grade: {
        stance: "voided", brandRank: null, platformsNamed: [], winner: null, caveat: false,
        evidence: run.truncated ? "run did not finish - not graded" : "run failed - not graded",
        needsReview: false,
      },
      labels: null,
    };
  }
  const labels = emailLabels(run, opts);
  const p = labels.picked;
  return {
    grade: {
      stance: p.value ? "decided" : labels.named.length ? "considered" : "silent",
      decisionMode: labels.decided.mode,
      brandRank: null,
      platformsNamed: labels.named,
      winner: p.value,
      caveat: false,
      evidence: `${p.value ? `picked ${p.value} from the ${p.source}` : "nothing picked"}: ${p.evidence.join(" | ")}${p.conflict ? ` (${p.conflict})` : ""}`,
      needsReview: labels.unsure.some((u) => u.startsWith("picked:")),
    },
    labels,
  };
}
