/**
 * Where an in-flight wave has got to.
 *
 * A wave that runs unattended for eight hours needs an answer to one question asked at
 * 3am and again over coffee: is this working, and when will it be done? Both are read from
 * what is already stored, so checking costs nothing and cannot disturb the run.
 *
 * The estimate is deliberately built from this wave's own observed durations rather than
 * from any published figure. A rate limit, a slow repository, a model change — all of them
 * show up in the median without anyone modelling them.
 */
import type { WaveRow } from "@/db/waves";

export type SurfaceProgress = {
  surfaceLabel: string;
  surfaceKey: string;
  planned: number;
  done: number;
  ok: number;
  /** Stopped early, so stored but never graded. */
  voided: number;
  errored: number;
  /** Runs where a tool the model called reported a failure. */
  toolFailed: number;
  pending: number;
  medianDurationMs: number | null;
  /** Median duration times what is still owed. Null while nothing has finished. */
  etaMs: number | null;
  spentUsd: number;
};

export type WaveProgress = {
  planned: number;
  done: number;
  pending: number;
  surfaces: SurfaceProgress[];
  /** The longest surface ETA: they run to completion, so the wave ends when the last does. */
  etaMs: number | null;
  spentUsd: number;
  /** Distinct failures with how often each happened, worst first. */
  failures: { message: string; n: number }[];
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Groups error text so a repeated failure reads as one problem rather than fifty.
 *
 * Digits are masked because the varying part of a message — a cell id, a port, a
 * timestamp — is exactly what stops otherwise identical failures from grouping, and fifty
 * near-identical lines is how a single broken thing hides at 3am.
 */
const signature = (msg: string): string =>
  msg.replace(/\d+/g, "N").replace(/\s+/g, " ").trim().slice(0, 160);

export function waveProgress(
  rows: WaveRow[],
  planned: { surfaceKey: string; surfaceLabel: string; planned: number }[],
  errors: { surfaceLabel: string; message: string }[] = [],
): WaveProgress {
  const bySurface = new Map<string, WaveRow[]>();
  for (const r of rows) {
    if (!bySurface.has(r.surfaceLabel)) bySurface.set(r.surfaceLabel, []);
    bySurface.get(r.surfaceLabel)!.push(r);
  }

  const surfaces: SurfaceProgress[] = planned.map((p) => {
    const rs = bySurface.get(p.surfaceLabel) ?? [];
    // An error row is a visible record of a failure, not a measurement: the cell is still
    // owed, so it counts against neither `done` nor the debt being paid down.
    const real = rs.filter((r) => r.status !== "error");
    const durations = real.map((r) => r.durationMs).filter((n): n is number => typeof n === "number" && n > 0);
    const med = median(durations);
    const pending = Math.max(0, p.planned - real.length);
    return {
      surfaceLabel: p.surfaceLabel,
      surfaceKey: p.surfaceKey,
      planned: p.planned,
      done: real.length,
      ok: real.filter((r) => !r.truncated).length,
      voided: real.filter((r) => r.truncated).length,
      errored: rs.length - real.length,
      toolFailed: real.filter((r) => (r.toolErrors ?? []).length > 0).length,
      pending,
      medianDurationMs: med,
      etaMs: med === null ? null : med * pending,
      spentUsd: rs.reduce((a, r) => a + (r.costUsd ?? 0), 0) / 1e6,
    };
  });

  const etas = surfaces.map((s) => s.etaMs).filter((n): n is number => n !== null);
  const counts = new Map<string, number>();
  for (const e of errors) {
    const k = signature(e.message);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return {
    planned: surfaces.reduce((a, s) => a + s.planned, 0),
    done: surfaces.reduce((a, s) => a + s.done, 0),
    pending: surfaces.reduce((a, s) => a + s.pending, 0),
    surfaces,
    // Surfaces run to completion rather than in lockstep, so the wave ends when the slowest
    // one does. Summing them would over-report; taking the mean would under-report.
    etaMs: etas.length ? Math.max(...etas) : null,
    spentUsd: surfaces.reduce((a, s) => a + s.spentUsd, 0),
    failures: [...counts.entries()].map(([message, n]) => ({ message, n })).sort((a, b) => b.n - a.n),
  };
}

/** "3h 20m" — for a line a person reads once, half asleep, and acts on. */
export function humanDuration(ms: number | null): string {
  if (ms === null) return "unknown";
  // Tested before rounding: half a minute rounds up to 1, and "1m left" on something that
  // finishes in thirty seconds is the kind of small lie that stops a readout being trusted.
  if (ms < 60_000) return "under a minute";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
