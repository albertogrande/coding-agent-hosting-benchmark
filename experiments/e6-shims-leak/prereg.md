# E6 · Does the list in `/opt/shims` steer the pick?

Pre-registration. Committed before the first trial run; `scripts/run-experiment.mts` refuses
to run while this file or `design.json` has uncommitted changes, and stamps this file's commit
and sha256 on every run.

Registered 10 November 2026 by Alberto Grande. Part of the extension plan for
[Memory first, docs second](https://thebeat.dev/research/memory-first-docs-second/).

## Why

The published sandbox (`sandbox/Dockerfile`) shadows 28 deploy and container CLIs with a
one-line refusal in `/opt/shims/<name>`, first on `PATH`. In the published Opus 5.5 runs on the
three briefs with a goal (seasons 1 and its second night, 198 runs), **188 ran a shell command
that names `/opt/shims`**, and **91 listed the directory**, which prints 28 command names,
most of them hosts (`fly`, `render`, `railway`, `koyeb`, `northflank`, `vercel`, …).

The write-up's headline is that about half the picks come from memory (101 of 198 runs with
decision mode `prior`: no search, no page, no web lookup from the shell). Reading a local list
of host CLIs is not a web lookup, so it is counted as memory. If the list changes what the agent
names or picks, part of "memory" is the instrument talking. E6 measures that before the
instrument is fixed for the rest of the plan.

## Hypotheses

- **H1 (pick).** Without the list (`none`), the agent's picks move away from the published
  picks: the share of runs that match the published modal pick for their cell is lower than
  in the concurrent control (`named`).
- **H2 (memory share).** Without the list, the share of runs decided from memory changes.
  Direction not predicted: the list could prompt a lookup (lower `prior` with the list) or
  stand in for one (higher `prior` with the list).
- **H3 (mentions).** Without the list, fewer runs mention hosts whose CLI name is on the list
  (Koyeb, Railway, Northflank, Coolify, Dokku, Kamal, CapRover, Heroku, Supabase, DigitalOcean,
  Elastic Beanstalk/Copilot), counted in the closing text.
- **H0** for each: no difference.

## Arms

All three are built by `sandbox/Dockerfile.arm` from one base image (`sandbox/Dockerfile`
with Claude Code 2.1.321), so they share every layer but the last. Digests are pinned in
`design.json`; `build-images.sh` rebuilds them.

| Arm | What the agent finds | Role |
|---|---|---|
| `named` | `/opt/shims` as published: 28 symlinks to `_shim`, first on `PATH`, listable | concurrent control |
| `neutral` | the same 28 commands with the same refusal, in `/usr/local/libexec/bin` (mode 0711: commands resolve, the directory cannot be listed) | removes the list, keeps "the CLI exists" |
| `none` | no deploy or container CLI at all (`command not found`) | removes both |

`named` vs `none` is the primary contrast. `neutral` separates the list from the mere
presence of a command the agent asked for by name.

The concurrent control replaces any comparison with the published season for inference:
the CLI moved from 2.1.280 to 2.1.321 and the served model may have moved. The published
runs are used only to fix the reference pick for each cell (below), which is the same for
every arm.

## Fixed across arms

- Model `claude-opus-5-5`, `--effort high`, Claude Code 2.1.321, headless,
  `--dangerously-skip-permissions`, stream-json, 30-minute timeout.
- The 11 forks at the SHAs in `waves/hosting-s1-opus55.json`; the three briefs with a goal
  from `prompts/hosting-s0.json` (`least-effort`, `cost`, `production`), verbatim.
- One container per run, a fresh clone per run, Docker `--network host` (this machine's
  daemon has no bridge), the machine's own Claude Code login mounted read-only.

## Units, n, order and stopping

- Cell = app × brief: 33 cells. One run per cell per arm: **33 blocks × 3 arms = 99 runs**.
- Order: cells shuffled with seed 20261110; each cell is a block that runs its three arms
  back to back, arm order shuffled per block. A night that ends early leaves matched blocks.
- Stop: all 99 runs, or 08:15 Madrid on 11 November 2026, whichever comes first; the
  remainder can be run on a later night with the same design. Claude Max allows roughly 35
  runs per 5-hour window, so one night is expected to complete about 20–25 blocks.
- A run that times out or exits non-zero is stored as `voided`; a block with any voided or
  errored run is left out of the paired tests and reported.
- Two smoke runs before the first trial (one block's first arms, into `smoke/`) check the
  login, the network and the extraction. They are never analysed.

## Measures

Per run, from the transcript and the repository, with the harness's existing code:

- `adopted`: the host committed to, by the adoption ladder (`src/derive/adoption.ts`:
  config file → deploy command → closing prose). Automatic labels only; no model review and
  no human audit for this experiment (the published picks were reconciled by model reviews).
- `decisionMode` (`prior` | `search` | `fetch` | `shell`), as published.
- **Reference pick** for a cell: the modal `adopted` over the 6 published Opus 5.5 runs
  (season 1 and its second night). A run *agrees* if its pick is a modal pick (ties: any).
- Shim exposure: any shell command naming the shim directory; a listing of it (`ls` on it);
  probes of deploy CLIs by name (`which`, `command -v`, `type`, `<cli> --version|whoami|auth`).
- Mentions of list-only hosts (H3) in the closing text, any context.
- Hosts named (`platformsNamed`, the grader's rule) and number of distinct picks per arm.
- Duration, turns, input/output/cache tokens and `total_cost_usd` (the CLI's API-equivalent
  price; the runs are paid by a Claude Max subscription).

## Analysis rule

- **Primary (H1):** agreement with the reference pick, `named` vs `none`, paired by block:
  exact two-sided McNemar test on discordant blocks; the difference in proportions with a 95%
  interval (Newcombe, paired). Same for `named` vs `neutral` as secondary.
- **H2:** `prior` share, same paired test. **H3:** mention share, same paired test.
- Per-arm distribution of picks, with Wilson 95% intervals on each arm's agreement and
  `prior` shares.
- Two-sided α = 0.05, no correction across the three hypotheses; all three are reported
  whatever they show.

## Decision rule

Applied only when at least 30 complete blocks exist (possibly after a second night):

- If H1 or H2 is rejected for `named` vs `none`, the `none` image becomes the instrument for
  the later phases of the plan, and the Memory first page gets a dated note saying what the
  list did.
- If neither is rejected, `named` stays comparable with the published record, and the note
  says the list did not detectably move picks or the memory share, with the smallest effect
  this n could have detected.

With fewer complete blocks, the results are reported as interim and descriptive, and no
instrument decision is taken.

## Known limits

- One run per cell per arm: the paired tests have little power for small effects. About 30
  blocks detect a difference of roughly 25 percentage points in agreement at 80% power, not 10.
- Automatic labels only. The published labels were reviewed; a ladder disagreement shows up
  equally in all arms, but it adds noise to the agreement measure.
- `neutral` still tells the agent a command exists when it asks for it by name, and a run can
  read the refusal script. That is the point of the arm, and also why it is not `none`.
- In `none`, `docker` is also absent, which matches the published sandbox in effect (the
  published `docker` refused too).
