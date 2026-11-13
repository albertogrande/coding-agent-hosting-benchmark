# E2 · Does a Railway config already in the tree change the pick?

Pre-registration. Committed before the first trial run; `scripts/run-experiment.mts` refuses
to run while this file or `design.json` has uncommitted changes, and stamps this file's commit
and sha256 on every run.

Registered 13 November 2026 by Alberto Grande. Follows E1 (`experiments/e1-agents-md/`),
which found that a realistic `AGENTS.md` saying "We deploy on Railway" raised the Railway
pick share from 1 of 99 in a concurrent control to 96 of 99. The plan's next question,
once instructions were shown to move the pick, is the incumbent: a host config already
in the repository. This experiment is that question, run as its own 198-run night
with a concurrent control, not as one arm of the plan's six-arm E2–E5 wave.

The treatment is a per-app Railway config committed as the run's base. That is the
"stronger, stack-specific" signal E1's prereg named as closer to E2. There is no
`AGENTS.md`. The plan's E2b (an incumbent file plus a conflicting instruction) is not
included; it is a different contrast, for a later experiment.

## Why

E1 showed that a one-line instruction is enough to move almost every pick to Railway.
A vendor or a team that already deploys on Railway would more often have a config file
in the tree than an instructions file that names the host. The question is whether that
incumbent is kept, and whether it moves the pick relative to a concurrent control that
has no such file.

The plan's E2a criterion was that the agent maintains an incumbent config (of a host
that is not already the cell's favourite) in at least 70% of cases. Railway is not the
favourite of these cells: it was picked in 1 of 99 E1 control runs and in 0 of 198
published Opus 5.5 runs. Using Railway on every app satisfies "not the favourite"
without assigning a different host per cell.

The concurrent control replaces any comparison with E1's 1% or the published 0%.
E7 found that night-to-night variation on the same CLI and model is large enough
that a historical baseline is not a fair test. Both arms of E2 run in the same
session, interleaved within blocks.

## Hypotheses

- **H1 (Railway pick, primary).** The share of runs that pick Railway is higher with
  the incumbent Railway config (`railway-incumbent`) than in the concurrent control.
- **H2 (memory share, secondary).** The share of runs decided from memory
  (`decisionMode === "prior"`) differs between the arms. Direction not predicted:
  an existing config could stand in for a lookup (higher `prior`) or prompt a
  documentation fetch to understand or migrate it (lower `prior`).
- **H0** for each: no difference.

Direction on H1 is predicted from the treatment; both tests are two-sided, as in
E1, E6 and E7.

A descriptive criterion, taken from the plan's E2a and not used as the inferential
test: under treatment, the incumbent is *retained* (status `kept` or `modified`,
including a migrate to another Railway config path) in at least 70% of complete
treatment runs. This is reported beside H1, with a Wilson 95% interval, and broken
down by `kept`, `modified`, `deleted` and `replaced`.

A second descriptive criterion, as in E1: under treatment, Railway is the modal
pick (at least two of the three repetitions) in at least 17 of the 33 (app × brief)
cells.

## Arms

Both arms run on one image, `aeo-sandbox:e6-named` (the published shims, Claude Code
2.1.321), digest pinned in `design.json`. That is the instrument E6 kept, in the
rebuild recorded as E7's Amendment 1. The arms differ only in the overlay.

| Arm | What the agent finds | Role |
|---|---|---|
| `control` | the fork at its pinned SHA, nothing added | concurrent control |
| `railway-incumbent` | the same checkout, with a per-app Railway config committed as the run's base before the agent starts | treatment |

The overlay is applied by the harness (`applyOverlay`): files under
`overlays/railway-incumbent/apps/<app>/` are copied with that prefix stripped,
committed under a neutral identity (`maintainer`, message "Update project notes"),
and `baseSha` becomes that commit, so `changedFiles` counts only what the agent
did. The forks themselves never change. `{{app}}` in a file body is replaced with
the target id.

Each app has its own `railway.toml` (the voting app has one per service, under
`vote/`, `result/` and `worker/`), with a stack-specific build and start command
a maintainer might have committed: Dockerfile where the fork already has one,
Nixpacks otherwise, health checks and restart policy where the app is an HTTP
service, a pre-deploy migrate where the app has a database, a cron note on the
scheduled job. The files name Railway as the host only by being Railway config
files; they do not instruct the agent to prefer Railway over alternatives, and
there is no `AGENTS.md`. They are deliberately ordinary, and they may be slightly
wrong for a given fork — a real incumbent often is — so a careful agent can
edit them. An edit that leaves a Railway config in the tree is `modified`, not
a failed treatment.

The classic `railway.toml` format is used, even though Railway has announced that
`railway.toml` / `railway.json` stop being read on 1 December 2026 (18 days after
registration). That is the file a team that set this up in 2025 would still have
in the tree. A migrate to `.railway/railway.ts` is counted as `modified` (same
platform), not as `replaced`. The ladder was extended to recognise that IaC path
before this prereg (`5645f4d`), so those migrates are visible without review.

## Fixed across arms

- Model `claude-opus-5-5`, `--effort high`, Claude Code 2.1.321, headless,
  `--dangerously-skip-permissions`, `--output-format stream-json`, 30-minute
  timeout.
- Published shims (`named`), `/opt/shims` as E6 settled it.
- Image digest `sha256:526bcffec39016c5ec7aedddfd0469301681e5c3c60eaf3b2a22d2fd3e535525`.
- The 11 forks at the SHAs in `waves/hosting-s1-opus55.json`.
- Briefs `least-effort`, `cost`, `production` from `prompts/hosting-s0.json`
  (the three briefs with a goal).
- Three repetitions. Order seed `20261113` (a new seed, not E1's). 99 blocks ×
  2 arms = 198 runs. The runner shuffles cells by the seed, then runs both arms
  of a cell back to back, with arm order shuffled per block.
- Network `host`, machine Claude Code login mounted read-only, `auth` =
  `credentials-file`.

## Instrument, recorded on every run

The runner records `incumbent`: `{ file, files, platform, status, replacedBy }`,
where `status` is `kept` (unchanged), `modified` (edited, or migrated to another
Railway config path), `deleted` (gone, nothing in its place) or `replaced`
(gone, a different platform's config written). Control runs have `incumbent:
null`. A kept or modified Railway incumbent fills a missing ladder pick
(`adoptionSource` `incumbent-kept` or `incumbent-modified`) unless the ladder
already adopted a *different* platform, in which case the ladder's verdict
stands. This rule is applied by the runner as the run is stored, and is the
automatic label. Leftovers the ladder still leaves as `needs-review` or
`unlisted` are reviewed from a blind packet.

A harness change, committed as `5645f4d` before this prereg and not an
amendment of it: the adoption ladder recognises `.railway/railway.ts` (and a
directory-only `.railway/` path) as a Railway config, and `railway config apply`
as a deploy command. E1's stored labels and results are not re-derived.

## Measures

- `adopted`: the host committed to, by the adoption ladder plus the incumbent
  rule above. Runs the ladder (after that rule) still leaves as `needs-review`
  or `unlisted` are labelled from a blind packet, under the same rule as E6's
  Amendment 1 and E1 (closing text and the changed-file list; no arm, no run
  key, shim paths masked; the rule in `docs/REVIEW-RECONCILIATION.md`). The
  incumbent file path is masked as `[config file]` so the treatment artifact
  does not itself suggest the pick. **H1 uses the reviewed labels.** The
  automatic-only labels (ladder plus incumbent rule, no review) are reported
  beside it as a sensitivity analysis.
- `incumbent.status`, on the treatment arm, as above. *Retained* means `kept`
  or `modified`.
- `decisionMode` (`prior` | `search` | `fetch` | `shell`), as in E1, E6 and E7.
- **Opened the incumbent:** a tool call or shell command whose path or text
  contains `railway.toml`, `railway.json`, or `.railway/`. Reported
  descriptively. It is not treated as "the agent saw the file": E1 found that
  a file can be in context without an opened-file marker, and the same limit
  applies here. There is no H1b that conditions the pick on this marker.
- **Cited the incumbent:** the closing text mentions `railway.toml`,
  `railway.json`, `.railway/`, or "existing" / "already" / "in the tree" /
  "in the repository" together with Railway. Descriptive.
- Railway documentation: a `WebFetch` whose URL contains `railway.app` or
  `railway.com`, or a `WebSearch` whose query mentions Railway as a host.
  Descriptive, and a component of how H2's direction is read.
- Duration, turns, tokens and `total_cost_usd`. CLI version, overlay files,
  `baseSha`, image digest, recorded on the run.

## Analysis rule

- **Primary (H1):** Railway pick (`adopted` canonicalises to "Railway"),
  `railway-incumbent` vs `control`, paired by block: exact two-sided McNemar
  test on discordant blocks; the difference in proportions with a 95% interval
  (Newcombe, paired).
- **H2:** `prior` share, same paired McNemar and Newcombe interval as H1.
- Per-arm Railway pick share and `prior` share with Wilson 95% intervals; the
  distribution of picks and of decision modes; the incumbent-status distribution
  on the treatment arm, with the retained share and its Wilson interval; opened
  and cited shares on the treatment arm (and, as a check, on the control, where
  both should be near zero); the share that fetched or searched Railway
  documentation; a breakdown by app and by brief; the number of (app × brief)
  cells in which Railway is the modal pick on each arm. About 99 blocks detect
  a difference of roughly 15 percentage points at 80% power.
- Two-sided α = 0.05, no correction across the hypotheses; all are reported
  whatever they show.

## Decision rule

Applied only when at least 90 complete blocks exist:

- If H1 is rejected and the difference is in the predicted direction (higher
  Railway share with the incumbent config), the pre-registered note is that a
  Railway config already in the tree does change the pick, with the estimated
  difference, its interval, the incumbent-retention share, and the cell-majority
  count.
- If H1 is not rejected, the note is that the incumbent config did not
  detectably move the Railway pick share at this n, with the smallest effect
  this n could have detected (about 15 percentage points at 80% power). The
  retention share and the cell-majority count are still reported.

With fewer complete blocks, the results are reported as interim and descriptive,
and no decision is taken.

## Known limits

- The control has no Railway config at all, so the contrast cannot separate
  "a config file is present" from "the file is a Railway config." That is the
  question asked, and it is also a limit.
- Railway is not a natural fit for every app. The by-app breakdown is how that
  is reported, not a reason to drop a cell.
- The per-app start commands may be slightly wrong for a given fork. An edit
  is `modified` if a Railway config remains, and is expected.
- `railway.toml` is 18 days from deprecation at registration. A migrate to
  Railway's IaC format is `modified`. An agent that deletes the file *because*
  it is deprecated, and does not replace it with another Railway config, is
  `deleted` (or `replaced` if a different host is written). That is a real
  outcome, not a void.
- Opened-file markers are not a measure of whether the agent saw the incumbent.
  Citation and incumbent status are the better descriptions of engagement.
- Both arms receive today's served `claude-opus-5-5`. The concurrent control
  is the comparison, not E1 and not the published 0 of 198.
- The published shims stay in both arms, per E6. This is not a test of the list.
- This is not E1's treatment, and it is not the plan's E2b (incumbent versus a
  conflicting instruction). Those remain separate questions.
- Automatic pick labels, with a review of the ladder leftovers by a single
  automated reader from a blind packet, as in E1, E6 and E7. No person audits
  the labels.

## Smoke

Two runs of one cell (both arms), stored under `smoke/` and never analysed,
check that the overlay is committed as the base on the treatment arm (the
Railway config is in the tree, not in `changedFiles` unless the agent edited
it), that `incumbent` is recorded and is non-null only on treatment, that
the control has no Railway config, and that the image and CLI version match
the pins.
