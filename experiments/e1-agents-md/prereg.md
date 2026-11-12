# E1 · Does an `AGENTS.md` that names a host change the pick?

Pre-registration. Committed before the first trial run; `scripts/run-experiment.mts` refuses
to run while this file or `design.json` has uncommitted changes, and stamps this file's commit
and sha256 on every run.

Registered 12 November 2026 by Alberto Grande. Follows E6 (`experiments/e6-shims-leak/`),
which kept the published (`named`) sandbox as the instrument, and E7
(`experiments/e7-cli-version/`), which left night-to-night variation as a remaining
cause of movement in the memory share. This is the first experiment of the planned
repo-signal series: an instructions file that names a host.

## Why

The published Opus 5.5 record (season 1 and its second night, 198 runs on the three
briefs with a goal) never picked Railway: 0 of 198. The agent *named* Railway in 23 of
99 season-1 runs and 18 of 99 second-night runs (41 of 198, about 21%). That is the
case "named and never chosen", and the one a vendor would most want to move. The
question is whether a realistic `AGENTS.md` that states "We deploy on Railway" is
enough to change the pick.

The concurrent control replaces any comparison with the published 0% for inference.
E7 found that the memory share on the same CLI, model, briefs and shims moved from
24% (E6's `named` arm) to 39% (E7's `v321` arm) across two days, a gap large enough
that a historical baseline is not a fair test. Both arms of E1 run in the same
session, interleaved within blocks.

## Hypotheses

- **H1 (Railway pick, primary).** The share of runs that pick Railway is higher with
  the `AGENTS.md` (`agents-md-railway`) than in the concurrent control.
- **H1b (reading the file).** Among treatment runs, the Railway pick share is higher
  when the agent read `AGENTS.md` (`signalRead`) than when it did not. This is
  observational: reading is not assigned. If `signalRead` is nearly universal or
  nearly absent, H1b is uninformative and is reported as such.
- **H2 (memory share, secondary).** The share of runs decided from memory
  (`decisionMode === "prior"`) differs between the arms. Direction not predicted:
  an instruction could stand in for a lookup (higher `prior` with the file) or
  prompt a Railway documentation fetch (lower `prior` with the file).
- **H0** for each: no difference.

Direction on H1 and H1b is predicted from the treatment, but the tests are two-sided,
as in E6 and E7.

A descriptive criterion, taken from the plan and not used as the inferential test:
under treatment, Railway is the modal pick (at least two of the three repetitions)
in at least 17 of the 33 (app × brief) cells. This is reported beside H1.

## Arms

Both arms run on one image, `aeo-sandbox:e6-named` (the published shims, Claude Code
2.1.321), digest pinned in `design.json`. That is the instrument E6 kept, in the
rebuild recorded as E7's Amendment 1 (the measuring machine's Docker was wiped on
12 November 2026). The arms differ only in the overlay.

| Arm | What the agent finds | Role |
|---|---|---|
| `control` | the fork at its pinned SHA, nothing added | concurrent control |
| `agents-md-railway` | the same checkout, with a realistic `AGENTS.md` committed as the run's base before the agent starts | treatment |

The overlay is applied by the harness (`applyOverlay` in `src/runner/surfaces/agent-repo.ts`):
the file is copied, committed under a neutral identity (`maintainer`, message "Update
project notes") so that `git log` does not name the experiment, and `baseSha` becomes
that commit, so `changedFiles` counts only what the agent did. The forks themselves
never change.

The `AGENTS.md` is one file, identical on every app: a short development section
(install with the project's usual package manager, run the existing tests, do not
commit secrets) and a one-line deployment section, "We deploy on Railway." It names
no other host, gives no Railway-specific commands, and does not instruct the agent
to prefer Railway over alternatives. The file is stack-agnostic on purpose: invented
per-app commands that were wrong for some of the eleven would be a second treatment.
The plan's optional third arm, a `CLAUDE.md` with the same text (Claude Code loads
`CLAUDE.md` natively), is not included: E1 is sized to the plan's 198-run two-arm
design, and H1b measures whether this file was read. If it is rarely loaded, a
`CLAUDE.md` follow-up is the natural next experiment.

## Fixed across arms

- Model `claude-opus-5-5`, `--effort high`, Claude Code 2.1.321, headless,
  `--dangerously-skip-permissions`, stream-json, 30-minute timeout.
- The published shims (`/opt/shims`, first on `PATH`, listable), as E6 decided.
- The 11 forks at the SHAs in `waves/hosting-s1-opus55.json`; the three briefs with a
  goal from `prompts/hosting-s0.json` (`least-effort`, `cost`, `production`), verbatim.
- One container per run, a fresh clone per run, Docker `--network host` (this machine's
  daemon has no bridge), the machine's own Claude Code login mounted read-only.

## Units, n, order and stopping

- Cell for pairing = app × brief × repetition. 11 apps × 3 briefs × 3 repetitions =
  99 cells. One run per cell per arm: **99 blocks × 2 arms = 198 runs**. Three
  repetitions follow the plan, and given E7's night-to-night finding they also give
  a majority pick per (app × brief) cell and tighter intervals than E6 and E7's
  single pass.
- Order: cells shuffled with seed 20261112; each cell is a block that runs its two
  arms back to back, arm order shuffled per block. The two arms are therefore
  interleaved through every session, so a time-of-day effect, a mid-session usage-limit
  pause, or a night boundary cannot land on only one arm. A night that ends early
  leaves matched blocks. The three repetitions of the same (app × brief) may fall on
  different nights after the shuffle; each pair is still same-session.
- Stop: all 198 runs. There is no calendar deadline that would truncate the
  experiment; leftover blocks are run on later nights with the same design. Claude
  Max allows roughly 35 runs per 5-hour window, so 198 runs are about six windows.
  At a median of about 3–4 minutes per run, wall time is around eleven hours if the
  limit does not bind, plus login-refresh waits; the driver pauses and resumes
  across a limit.
- A run that times out or exits non-zero is stored as `voided`; a block with any
  voided or errored run is left out of the paired tests and reported.
- Two smoke runs before the first trial (the first block, one run per arm, into
  `smoke/`) check that the overlay is committed as the base on the treatment arm
  (and is not in `changedFiles` unless the agent edited it), that the control arm
  has no `AGENTS.md`, that the image and CLI version match the pins, and that
  extraction works. They are never analysed.

## Measures

Per run, from the transcript and the repository, with the harness's existing code
and the rules below:

- `adopted`: the host committed to, by the adoption ladder. Runs the ladder leaves
  as `needs-review` or `unlisted` are labelled from a blind packet, under the same
  rule as E6's Amendment 1 (closing text and the changed-file list; no arm, no run
  key, shim paths masked; the rule in `docs/REVIEW-RECONCILIATION.md`). **H1 uses
  the reviewed labels.** The automatic-only labels are reported beside it as a
  sensitivity analysis.
- `decisionMode` (`prior` | `search` | `fetch` | `shell`), as published and in E6
  and E7. A run is *prior* if `decisionMode === "prior"`.
- **`signalRead`:** true if the agent opened `AGENTS.md` or the transcript records
  it as loaded into context. Opened: a tool call (`Read`, `Edit`, `Grep`, `Glob`,
  or equivalent) whose path or detail contains `AGENTS.md`, or a shell command
  whose text contains `AGENTS.md` (for example `cat`, `head`, `ls`, `find`).
  Loaded into context: a `system` event in the stored stream-json transcript
  (including the `init` line) that names `AGENTS.md` as a memory, instruction, or
  similarly loaded file. If no such marker exists in the transcript format, that
  is reported, and `signalRead` is the "opened" rule only.
- **`signalCited`:** the closing text mentions `AGENTS.md` or the exact phrase
  "We deploy on Railway" (case-insensitive).
- **Railway documentation:** a `WebFetch` whose URL contains `railway.app` or
  `railway.com`, or a `WebSearch` whose query mentions Railway as a host
  (case-insensitive `railway`). Descriptive, and a component of how H2's
  direction is read.
- Duration, turns, input/output/cache tokens and `total_cost_usd` (the CLI's
  API-equivalent price; the runs are paid by a Claude Max subscription).
- The CLI version the image actually ran, checked against the pin; the overlay
  files and `baseSha`, recorded on the run.

## Analysis rule

- **Primary (H1):** Railway pick (`adopted` canonicalises to "Railway"),
  `agents-md-railway` vs `control`, paired by block: exact two-sided McNemar test
  on discordant blocks; the difference in proportions with a 95% interval
  (Newcombe, paired).
- **H1b:** among treatment runs only, Railway pick share with `signalRead` vs
  without, with Wilson 95% intervals on each share and a two-sided Fisher's exact
  test. Not a paired test: reading is not assigned.
- **H2:** `prior` share, same paired McNemar and Newcombe interval as H1.
- Per-arm Railway pick share and `prior` share with Wilson 95% intervals; the
  distribution of picks; the distribution of decision modes; `signalRead` and
  `signalCited` shares on the treatment arm (and, as a check, on the control,
  where `signalRead` should be zero because there is no file); the share that
  fetched or searched Railway documentation; a breakdown by app and by brief;
  the number of (app × brief) cells in which Railway is the modal pick (at least
  two of three repetitions) on each arm. About 99 blocks detect a difference of
  roughly 15 percentage points at 80% power, not 10 (E6 and E7's 33 blocks
  detected about 25).
- Two-sided α = 0.05, no correction across the hypotheses; all are reported
  whatever they show.

## Decision rule

Applied only when at least 90 complete blocks exist (possibly after further nights):

- If H1 is rejected and the difference is in the predicted direction (higher
  Railway share with the `AGENTS.md`), the pre-registered note is that an
  `AGENTS.md` that names Railway does change the pick, with the estimated
  difference, its interval, and the cell-majority count.
- If H1 is not rejected, the note is that the file did not detectably move the
  Railway pick share at this n, with the smallest effect this n could have
  detected (about 15 percentage points at 80% power). The cell-majority count is
  still reported.

With fewer complete blocks, the results are reported as interim and descriptive,
and no decision is taken.

## Known limits

- The control has no `AGENTS.md` at all, so the contrast cannot separate "an
  instructions file is present" from "the file names Railway." That is the
  question the plan asked (status quo vs a file that names a host), and it is
  also a limit.
- Railway is not a natural fit for every app (a static content site, a Discord
  bot, a scheduled job with no HTTP server). The by-app breakdown is the way
  that is reported, not a reason to drop a cell.
- `signalRead` can miss an auto-load that never appears in the stored transcript
  and is never followed by an explicit read. H1b is then conservative. The smoke
  runs will say whether a transcript marker exists.
- Both arms receive today's served `claude-opus-5-5`. The served model may have
  moved since the published nights; the concurrent control is the comparison.
- The published shims stay in both arms, per E6. This is not a test of the list.
- One treatment file, identical on every app. A more realistic per-app
  `AGENTS.md` (stack-specific commands, a Railway config already in the tree) is
  a different, stronger treatment, closer to E2.
- Automatic pick labels, with a review of the ladder leftovers by a single
  automated reader from a blind packet, as in E6 and E7. No person audits the
  labels.
