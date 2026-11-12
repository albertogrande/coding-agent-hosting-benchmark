# E7 · Results — Does the Claude Code release change decision mode?

Analysis of the day of 12 November 2026, by the rule in `prereg.md`, via
`scripts/analyse-e7.mts`. Runs finished 12 November 2026, 16:01 Madrid. The 11
ladder leftovers were labelled the same afternoon; this file reports the
registered tests, which do not use those labels, and the reviewed pick
distribution as description. Generated 12 November 2026, 16:07 Madrid.

All 66 planned runs finished and were stored: 33 cells × 2 arms, every run
`ok`, 33 of 33 blocks complete. No voids or errors. Every `v280` run recorded
`cliVersion` "2.1.280 (Claude Code)" and every `v321` run "2.1.321 (Claude
Code)". The decision rule applies.

Smoke runs in `smoke/` are not analysed.

## Headline

The Claude Code release did not detectably change the share of runs decided
from memory, or the share decided by fetching a page.

Primary contrast, `v280` vs `v321`, 33 paired blocks, two-sided α = 0.05:

| Hypothesis | v280 (2.1.280) | v321 (2.1.321) | Difference (v280 − v321) | 95% interval | McNemar |
|---|---|---|---|---|---|
| H1 · decided from memory (`prior`) | 16/33 (48% [33–65]) | 13/33 (39% [25–56]) | +9 points | [−6, 23] | b=5, c=2, p=0.453 |
| H2 · decided by fetching a page (`fetch`) | 13/33 (39% [25–56]) | 14/33 (42% [27–59]) | −3 points | [−20, 14] | b=4, c=5, p=1.000 |

H1 and H2 are not rejected. The H1 point estimate is in the predicted
direction (a higher memory share on 2.1.280) but the interval includes zero.
H2 is essentially flat. Intervals are Newcombe (paired); the p-value is the
exact two-sided McNemar test on discordant blocks. Shares have Wilson 95%
intervals.

**Decision rule.** H1 is not rejected, so the pre-registered note for the
Memory first page is that the CLI release did not detectably move the memory
share at this n. This n can detect a difference of about 25 percentage points
at 80% power, not 10. The H1 interval excludes a rise in the memory share on
2.1.280 larger than 23 points, and so excludes a CLI effect as large as the
published-to-E6 drop of about 27 points. The published-vs-E6 drop would then
need another cause (a change in the served model, night-to-night variation,
or both). That note is not written here: this file is the experiment record
only.

E7's own `v321` memory share, 13/33 (39% [25–56]), is higher than E6's
concurrent-control 8/33 (24% [13–41]) on the same CLI, model, briefs and
shims, and closer to the published 101/198 (51% [44–58]). That is
description, not a registered test, and it sits with night-to-night variation
as a remaining cause.

## Amendment 1 · images rebuilt mid-experiment

The measuring machine's Docker installation and all sandbox images were lost
during a box runtime rollout at 11:32–11:34 Madrid, while run 28
(`healthchecks.cost`, arm `v280`) was in flight. That run was not stored and
was repeated after the images were rebuilt from the same Dockerfiles. The
first 27 stored runs keep the original image digests, recorded on each run
file; the later 39 runs use the rebuilt digests pinned in Amendment 1 of
`prereg.md` and `design.json`. Both rebuilt arms still differ only in the
last layer (the Claude Code release).

This split is not a clean block boundary. Blocks 0–12 (13 complete blocks)
ran both arms on the original images. Block 13 (`healthchecks.cost`) is
mixed: `v321` on the original image, `v280` on the rebuilt one; both decided
by `fetch`. Blocks 14–32 (19 complete blocks) ran both arms on the rebuilt
images.

Paired tests on the two homogeneous subsets, reported so the 33-block result
is not pooled without comment:

| Subset | Blocks | H1 prior (v280 − v321) | McNemar | H2 fetch (v280 − v321) | McNemar |
|---|---|---|---|---|---|
| Original images (blocks 0–12) | 13 | 0 points [−27, 27] | b=2, c=2, p=1.000 | −8 points [−32, 18] | b=1, c=2, p=1.000 |
| Rebuilt images (blocks 14–32) | 19 | +16 points [−1, 31] | b=3, c=0, p=0.250 | 0 points [−23, 23] | b=3, c=3, p=1.000 |

The H1 point estimate is concentrated in the rebuilt blocks (all three
discordant blocks there have `prior` on `v280` and not on `v321`), but that
subset also does not reject H1. On the original images the memory share is
8/13 versus 8/14. Neither split moves the instrument decision.

## Reviews of leftover pick labels

Eleven runs the ladder left as `needs-review` or `unlisted` (7 `v280`, 4
`v321`) were labelled from the blind packet in
`scripts/e7-review-packet.mts`: closing text and the changed-file list, with
the arm, the run key and the shim paths masked. Labels are in
`experiments/e7-cli-version/reviews.json`. The rule is the one in
`docs/REVIEW-RECONCILIATION.md`. Decision mode does not depend on these
labels; they are used only for the pick distribution below.

The reader was a single automated review by an assistant, not the three
independent reviews of the published record, and no person audited the labels.
That is a stated caveat on every row and on this analysis.

The 11 labels: Streamlit Community Cloud (4), GitHub Actions (2), Oracle
Cloud (2), GitHub Pages (1), Cloudflare (1), Self-managed VM (1). No run was
left as no pick. Neon, where it appeared, was treated as a backing database,
not the host. The two Oracle Cloud Always Free leftovers were given the
published catalogue name Oracle Cloud.

## Decision modes

| Mode | v280 (n=33) | v321 (n=33) |
|---|---|---|
| `prior` | 16 | 13 |
| `fetch` | 13 | 14 |
| `shell` | 4 | 3 |
| `search` | 0 | 3 |

The three `search` runs are all on `v321`, all after the image rebuild
(blocks 18, 19 and 23). That is description, not a registered test.

## Pick distributions (reviewed)

| Pick | v280 (n=33) | v321 (n=33) |
|---|---|---|
| Render | 15 | 16 |
| Fly.io | 9 | 9 |
| Streamlit Community Cloud | 2 | 2 |
| Cloudflare | 2 | 1 |
| Netlify | 0 | 2 |
| GitHub Actions | 1 | 1 |
| Oracle Cloud | 1 | 1 |
| GitHub Pages | 1 | 0 |
| Google Cloud Run | 1 | 0 |
| Self-managed VM | 1 | 0 |
| Vercel | 0 | 1 |

The two arms picked the same host in 25 of 33 blocks. Under the automatic
labels only, 23 of 33 agree; reviewing the 11 leftovers filled every no-pick
and did not enter the decision-mode tests. The eight blocks that still
disagree are `astro-blog.least-effort`, `langchain-nextjs.least-effort`,
`langchain-nextjs.production`, `discord-bot.production`,
`linkding.production`, `fastapi-postgres.production`,
`langchain-nextjs.cost` and `hourly-digest.production`. Render and Fly.io
together are 24 of 33 on `v280` and 25 of 33 on `v321`.

## Timing

The median run was 3.3 minutes on both arms (range 1.2–21.3 on `v280`,
1.3–19.2 on `v321`). Mean API-equivalent cost was $0.76 per run on `v280`
and $0.88 on `v321`. The first trial started at 10:06 Madrid; the last
finished at 16:01 Madrid, including a mid-afternoon pause to rebuild the
sandbox images. The 08:00 Madrid deadline of 13 November was not reached.

## Caveats

- **Images rebuilt mid-experiment.** The first 27 runs and the later 39 runs
  are not the same instrument at the base-image layer. Both arms of each
  contrast still share a base and differ only in the Claude Code release.
  The registered tests are reported on all 33 blocks and, separately, on the
  two homogeneous block subsets; see Amendment 1 above.
- **Single automated reviewer.** The 11 leftover pick labels are one
  assistant reading of the blind packet, not three independent reviews, and
  no person has audited them. A different reading of the same closing texts
  could move a pick; it cannot move H1 or H2.
- One run per cell per arm, as registered. The paired tests have little
  power for effects around 10 points.
- Both arms received today's served `claude-opus-5-5`. E7 isolates the CLI,
  not a combination of CLI and an October model snapshot.
- The published shims stay in both arms, per E6. This is not a test of the
  list.
- All 66 runs are in. There is no partial-n interim.

The H1-discordant blocks are `astro-blog.least-effort` (`shell` vs `prior`),
`streamlit-llm.least-effort` (`prior` vs `fetch`),
`fastapi-postgres.least-effort` (`fetch` vs `prior`),
`astro-blog.production` (`prior` vs `shell`), `streamlit-llm.cost` (`prior`
vs `search`), `mcp-streamable-http.cost` (`prior` vs `fetch`) and
`fastapi-postgres.production` (`prior` vs `fetch`).
