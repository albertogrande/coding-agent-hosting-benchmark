# E7 · Does the Claude Code release change decision mode?

Pre-registration. Committed before the first trial run; `scripts/run-experiment.mts` refuses
to run while this file or `design.json` has uncommitted changes, and stamps this file's commit
and sha256 on every run.

Registered 11 November 2026 by Alberto Grande. Follows E6
(`experiments/e6-shims-leak/`), which kept the published (`named`) sandbox as the instrument
and left a drop in the memory share unexplained.

## Why

The published Opus 5.5 record (season 1 and its second night, 198 runs on the three briefs
with a goal) was gathered on Claude Code **2.1.280**. That is the release pinned in
`waves/hosting-s1-opus55.json`, `waves/hosting-s1-night2-opus55.json`, `docs/SEASONS.md` and
the published JSON (`cliVersion`: "2.1.280 (Claude Code)"). About half those runs were
decided from memory: 101 of 198 had decision mode `prior` (51% [44–58]).

E6's concurrent control ran the same model (`claude-opus-5-5`), the same effort (`high`),
the same 11 forks and the same three briefs, on Claude Code **2.1.321**, with the published
shims. Its `prior` share was 8 of 33, 24% [13–41], and decision mode had shifted toward
`fetch`. E6 showed that the `/opt/shims` list did not detectably cause that drop. The CLI
release is the other planned difference between the published nights and E6, and the one
this experiment isolates. The served model may also have moved; E7 cannot freeze it to
October, and both arms will receive whatever `claude-opus-5-5` is today.

`@anthropic-ai/claude-code@2.1.280` is still on npm and installs in the sandbox (confirmed
before registration; both arm images are pinned in `design.json`). 2.1.260, the season 0
release, is not used: it rejects `claude-opus-5-5` (`waves/hosting-s1-opus55.json`).

## Hypotheses

- **H1 (memory share, primary).** The share of runs decided from memory (`decisionMode ===
  "prior"`) is higher on 2.1.280 than on 2.1.321.
- **H2 (fetch share, secondary).** The share of runs decided by fetching a page
  (`decisionMode === "fetch"`) is higher on 2.1.321 than on 2.1.280.
- **H0** for each: no difference.

Direction is predicted from the published-vs-E6 gap, but the tests are two-sided, as in E6.

## Arms

Both are built by `sandbox/Dockerfile.season` from one base image, `aeo-sandbox:e6-named`
(the published shims, digest pinned in `design.json`; E6's decision was to keep this
instrument). They share every layer but the last, which is `npm install -g
@anthropic-ai/claude-code@<version>`. Digests are pinned in `design.json`;
`build-images.sh` rebuilds them.

| Arm | Claude Code | Role |
|---|---|---|
| `v280` | 2.1.280 | the published study's CLI |
| `v321` | 2.1.321 | the CLI used for E6, current at registration |

`v280` vs `v321` is the only contrast. The runner reads each arm's `claudeVersion` so the
harness can check the image against the pin (`scripts/run-experiment.mts`).

## Fixed across arms

- Model `claude-opus-5-5`, `--effort high`, headless, `--dangerously-skip-permissions`,
  stream-json, 30-minute timeout.
- The published shims (`/opt/shims`, first on `PATH`, listable), as in season 1 and E6's
  `named` arm.
- The 11 forks at the SHAs in `waves/hosting-s1-opus55.json`; the three briefs with a goal
  from `prompts/hosting-s0.json` (`least-effort`, `cost`, `production`), verbatim.
- One container per run, a fresh clone per run, Docker `--network host` (this machine's
  daemon has no bridge), the machine's own Claude Code login mounted read-only.

## Units, n, order and stopping

- Cell = app × brief: 33 cells. One run per cell per arm: **33 blocks × 2 arms = 66 runs**.
  That is inside the 60–70 run night this experiment is sized for.
- Order: cells shuffled with seed 20261111; each cell is a block that runs its two arms
  back to back, arm order shuffled per block. The two CLIs are therefore interleaved
  through the night, so a time-of-day or a mid-night usage-limit pause cannot land on only
  one arm. A night that ends early leaves matched blocks.
- Stop: all 66 runs, or a deadline set when the night starts, whichever comes first; the
  remainder can be run on a later night with the same design.
- Claude Max allows roughly 35 runs per 5-hour window. 66 runs are two windows if the
  limit binds. At E6's median of about 3–4 minutes per run, 66 runs are around five hours
  of wall time if it does not, plus login-refresh waits and a long tail; one evening and
  night should finish them, with the driver pausing and resuming across a limit.
- A run that times out or exits non-zero is stored as `voided`; a block with any voided or
  errored run is left out of the paired tests and reported.
- Two smoke runs before the first trial (the first block, one run per arm, into `smoke/`)
  check that both images start, that 2.1.280 and 2.1.321 are the versions the harness
  records, and that extraction works. They are never analysed.

## Measures

Per run, from the transcript and the repository, with the harness's existing code:

- `decisionMode` (`prior` | `search` | `fetch` | `shell`), as published and in E6. This is
  the outcome. A run is *prior* if `decisionMode === "prior"`, *fetch* if `=== "fetch"`.
- `adopted`, by the adoption ladder, for description only. Automatic labels; runs the
  ladder leaves as `needs-review` or `unlisted` are reported and, if they appear, labelled
  later under the same Amendment 1 rule as E6. Decision mode does not depend on that
  label.
- The CLI version the image actually ran (`cliVersion` / `claude --version`), checked
  against the arm's pin.
- Duration, turns, input/output/cache tokens and `total_cost_usd` (the CLI's
  API-equivalent price; the runs are paid by a Claude Max subscription).

## Analysis rule

- **Primary (H1):** `prior` share, `v280` vs `v321`, paired by block: exact two-sided
  McNemar test on discordant blocks; the difference in proportions with a 95% interval
  (Newcombe, paired).
- **H2:** `fetch` share, same paired test.
- Per-arm `prior` and `fetch` shares with Wilson 95% intervals; the distribution of
  decision modes; the distribution of picks, as description.
- Two-sided α = 0.05, no correction across the two hypotheses; both are reported whatever
  they show.

## Decision rule

Applied only when at least 30 complete blocks exist (possibly after a second night):

- If H1 is rejected, later experiments pin the Claude Code release or treat it as a
  factor, and the Memory first page gets a dated note saying the CLI version moved the
  memory share, with the estimated difference.
- If H1 is not rejected, the note says the CLI release did not detectably move the
  memory share at this n, with the smallest effect this n could have detected (about 25
  percentage points at 80% power, as in E6). The published-vs-E6 drop would then need
  another cause (a change in the served model, night-to-night variation, or both).

With fewer complete blocks, the results are reported as interim and descriptive, and no
instrument decision is taken.

## Known limits

- One run per cell per arm: the paired tests have little power for small effects. About
  30 blocks detect a difference of roughly 25 percentage points at 80% power, not 10. The
  published-to-E6 gap was about 27 points, which this n can in principle detect; a smaller
  true effect may be missed.
- Both arms receive today's served `claude-opus-5-5`. E7 isolates the CLI, not a
  combination of CLI and a October model snapshot. A null result does not prove the
  served model is unchanged; a positive result still leaves some of the published-vs-E6
  gap possibly attributable to the model.
- The published shims stay in both arms, per E6. This is not a test of the list.
- Automatic pick labels only, and only as description. Decision mode is taken from the
  harness, as in the published record and E6.
