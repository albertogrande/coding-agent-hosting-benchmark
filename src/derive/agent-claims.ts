/**
 * The claims an agent report makes, from the benchmark it was built from.
 *
 * One list, so the page and the published dataset carry the same figures with the same
 * derivations: a reader checking a number on the page against the file is checking one
 * claim against itself, not two hand-written copies that may have drifted.
 */
import type { AgentBenchmark } from "./agent-benchmark";
import type { Claim } from "./claims";

export function agentClaims(b: AgentBenchmark, waveId: number): Claim[] {
  const claims: Claim[] = [];
  const g = b.gradeable;

  claims.push({
    id: "runs",
    label: "runs stored",
    value: b.runs,
    derivation: `rows in wave ${waveId} on ${b.surfaceKey}; ${b.gradeable} gradeable, ${b.voided} voided, ${b.errored} errored`,
    support: b.runs,
  });
  for (const a of b.adoption.filter((x) => x.adopted > 0)) {
    claims.push({
      id: `adopted-${a.platform}`,
      label: `${a.platform}: adopted`,
      value: Math.round(a.share * 100),
      derivation: `${a.adopted} of ${g} gradeable runs whose grade names ${a.platform} as the platform committed to in code` +
        (a.ci ? `; 95% interval ${Math.round(a.ci.lo * 100)}–${Math.round(a.ci.hi * 100)} from 800 resamples of repositories, seed 20260828` : "; no interval with fewer than two repositories"),
      support: a.adopted,
    });
  }
  if (b.undecided) {
    claims.push({
      id: "undecided",
      label: "no platform chosen",
      value: Math.round((g ? b.undecided / g : 0) * 100),
      derivation: `${b.undecided} of ${g} gradeable runs with no winner in their grade`,
      support: b.undecided,
    });
  }
  for (const r of b.byRepository.filter((x) => x.gradeable && x.adopted.length)) {
    claims.push({
      id: `repo-${r.target}`,
      label: `${r.target}: most often`,
      value: `${r.adopted[0].platform} ${r.adopted[0].n}/${r.gradeable}`,
      derivation: `commonest winner among the ${r.gradeable} gradeable runs whose cell targets ${r.target}`,
      support: r.gradeable,
    });
  }
  for (const f of b.byFrame.filter((x) => x.gradeable && (x.adopted.length || x.undecided))) {
    const top = f.adopted[0];
    const none = f.undecided > (top?.n ?? 0);
    const ci = f.intervals[none ? "(none)" : top.platform];
    claims.push({
      id: `frame-${f.frame}`,
      label: `${f.frame}: most often`,
      value: none ? `no platform ${f.undecided}/${f.gradeable}` : `${top.platform} ${top.n}/${f.gradeable}`,
      derivation: `commonest outcome among the ${f.gradeable} gradeable runs under the "${f.frame}" prompt` +
        (ci ? `; 95% interval ${Math.round(ci.lo * 100)}–${Math.round(ci.hi * 100)} from 800 resamples of the repositories that ran in the frame, seed 20260828` : "; no interval with fewer than two repositories"),
      support: f.gradeable,
    });
  }
  if (b.stability.comparable) {
    claims.push({
      id: "flip-rate",
      label: "repeat flip rate",
      value: Math.round((b.stability.flipRate ?? 0) * 100),
      derivation: `${b.stability.flipped} of ${b.stability.comparable} cells with 2+ gradeable repeats did not all commit to the same platform`,
      support: b.stability.comparable,
    });
  }
  for (const m of b.decisionModes) {
    claims.push({
      id: `decided-${m.mode}`,
      label: `decided from ${m.mode}`,
      value: m.runs,
      derivation: `gradeable runs whose grade records decision mode "${m.mode}" (fetch: opened a page; search: searched, opened none; prior: neither)`,
      support: m.runs,
    });
  }
  if (b.pagesOpened) {
    claims.push({
      id: "pages-opened",
      label: "pages opened",
      value: b.pagesOpened,
      derivation: `sources of kind "fetch" across ${b.fetched} gradeable runs that opened at least one page`,
      support: b.pagesOpened,
    });
  }
  return claims;
}
