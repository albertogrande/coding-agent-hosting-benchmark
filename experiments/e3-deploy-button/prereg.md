# E3 · Does a "Deploy on Railway" button in the README change the pick?

Pre-registration. Committed before the first trial run; `scripts/run-experiment.mts` refuses
to run while this file or `design.json` has uncommitted changes, and stamps this file's commit
and sha256 on every run.

Registered 14 November 2026 by Alberto Grande. Follows E1 (`experiments/e1-agents-md/`:
an `AGENTS.md` saying "We deploy on Railway" moved the Railway share from 1 of 99 to 96
of 99) and E2 (`experiments/e2-railway-incumbent/`: a per-app `railway.toml` in the tree
moved it from 0 of 99 to 64 of 99, not on the cost brief). The third repo signal in the
plan is the weakest and the most common one a vendor controls: a one-click deploy button
in the README.

## Why

The benchmark's own method assumes the answer. `method/REPOSITORIES.md` stripped "Deploy
on X" buttons and sections from three forks because "a deploy button decides the cell
before the agent starts", and the top-level README lists that stripping as a limit. That
was a design precaution, never a measurement. E3 measures it.

A button is weaker than E1's instruction (it does not say "we deploy on") and weaker than
E2's incumbent (nothing in the tree configures a host; the agent still has to write the
config). It is also the signal a host most often gets into third-party repositories,
through templates and starter kits.

E2's results name one limit this design fixes: its control had no config at all, so the
contrast could not separate "a config file is present" from "the file is Railway's". E3
adds a third arm with the same button for a different host, so "a deploy button is
present" and "the button is Railway's" are separate contrasts.

## Hypotheses

- **H1 (Railway pick, primary).** The share of runs that pick Railway is higher with a
  "Deploy on Railway" button (`railway-button`) than in the concurrent control.
- **H2 (memory share, secondary).** The share of runs decided from memory
  (`decisionMode === "prior"`) differs between `railway-button` and `control`. Direction
  not predicted: a button could stand in for a lookup (higher `prior`) or prompt a
  Railway documentation fetch (lower `prior`).
- **H3 (is it Railway, secondary).** The share of runs that pick *the host the button
  names* is the same under `railway-button` (Railway) and `koyeb-button` (Koyeb). Both
  hosts sit at or near zero without a button (Railway 0 of 99 and Koyeb 0 of 99 in E2's
  control), so a difference is a difference in how strongly the same cue pulls toward
  each host, not a difference in starting point.
- **H4 (does any button pull, secondary).** The share of runs that pick Koyeb is higher
  with a "Deploy to Koyeb" button (`koyeb-button`) than in the concurrent control.
- **H0** for each: no difference.

All tests are two-sided, as in E1, E2, E6 and E7.

How the contrasts read together (descriptive; no decision is taken from this table):

| H1 | H4 | H3 | Reading |
|---|---|---|---|
| rejected | rejected | not rejected | a deploy button pulls toward whichever host it names, about equally |
| rejected | rejected | rejected | any button pulls, Railway's more (or less) than Koyeb's |
| rejected | not rejected | rejected | the pull is specific to Railway (or to hosts the model already rates) |
| not rejected | — | — | a button did not detectably move the Railway pick at this n |

**Primary criterion** (descriptive, the plan's 70% bar as in E2, not the inferential
test): under `railway-button`, Railway is picked in at least 70% of complete runs. This is
the operational meaning of "a deploy button decides the cell". Reported with a Wilson 95%
interval, beside H1, whatever H1 shows. The same 70% bar is reported for Koyeb under
`koyeb-button`.

A second descriptive criterion, as in E1 and E2: under `railway-button`, Railway is the
modal pick (at least two of the three repetitions) in at least 17 of the 33
(app × brief) cells. The same count is reported for Koyeb under `koyeb-button`.

## Arms

All arms run on one image, `aeo-sandbox:e6-named` (the published shims, Claude Code
2.1.321), digest pinned in `design.json`, the instrument E1 and E2 ran on. The arms
differ only in the README the agent finds.

| Arm | What the agent finds | Role |
|---|---|---|
| `control` | the fork at its pinned SHA, nothing added | concurrent control |
| `railway-button` | the same checkout, with the fork's own `README.md` replaced by itself plus one "Deploy on Railway" button line, committed as the run's base | treatment |
| `koyeb-button` | the same, with a "Deploy to Koyeb" button line in the same place instead | comparison treatment |

The overlays are produced by `make-overlays.py` from each fork's `README.md` at its
pinned SHA. The button goes directly under the title block: appended to the existing
badge row where the README has one (`whoami`, `streamlit-llm`, `langchain-nextjs`,
`healthchecks`), otherwise as its own paragraph under the H1 (under the centred header
on `linkding`). The two button READMEs of an app are byte-identical except for that one
line. Nothing else is added: no deploy section, no prose, no `AGENTS.md`, no config file.

- `railway-button`:
  `[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/<fork>)`
- `koyeb-button`:
  `[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/<fork>&branch=<default>&name=<repo>)`

Both are each host's own button image and the repository form of its deploy link,
pointing at the fork the agent cloned. Both URLs answered 200 on 14 November 2026.
Railway's documented button now links a published template code; a code for these forks
would have to be invented and would 404, so the repository form (the original "Deploy on
Railway" generator's format, still served) keeps both buttons equally real.

### Why Koyeb is the neutral arm

The neutral arm has to hold "a one-click deploy button in the README" fixed and change
only the host. Each alternative fails one of the conditions below; Koyeb meets all four.

1. **No config file needed.** Koyeb's button deploys from the repository URL alone, as
   the Railway link above does. DigitalOcean's and Heroku's buttons, and Render's,
   require a committed `.do/deploy.template.yaml`, `app.json` or `render.yaml`, which
   would bring back the config-presence confound E3 exists to remove.
2. **Same starting point as Railway.** 0 of 99 in E2's concurrent control, as Railway
   was. Render (49 of 99) and Fly.io (25 of 99) are already the favourites, so a button
   for either has little room to move and would be read against a ceiling. Render's
   `render.com/deploy` link is also a deploy-command pattern in the adoption ladder,
   so a README edit carrying it would be labelled Render without a decision.
3. **Same kind of host.** A general-purpose container PaaS that runs every shape in the
   grid (web, worker, cron, Postgres add-on), as Railway does. Netlify and Vercel
   buttons need no config, but their hosts do not fit the worker, cron, Django or
   Compose apps, so a weaker pull there would be a fit effect, not a host effect.
4. **Equal footing in the sandbox.** `koyeb` is one of the 28 CLIs stubbed in
   `/opt/shims`, as `railway` is.

A host-agnostic badge (no host named) was rejected: it is not something a real README
carries, and it would change the form of the cue as well as the host.

Known differences between the two hosts, not removed and reported as limits: Koyeb is
much less known; it was acquired by Mistral AI in February 2026 and has had no free plan
for new sign-ups since. Railway's cheapest plan is also paid. The cost brief is where
these matter most, and the by-brief breakdown reports it.

Koyeb is not in the adoption ladder's closed vocabulary. A Koyeb pick stated in the
closing text is caught by the `unlisted` tier and goes to blind review, as E2's one
Koyeb pick did. The vocabulary is not extended for E3, because extending it changes
labels already published for seasons 0 and 1. The analysis canonicalises "Koyeb"
(any case) in reviewed labels.

## Fixed across arms

- Model `claude-opus-5-5`, `--effort high`, Claude Code 2.1.321, headless,
  `--dangerously-skip-permissions`, `--output-format stream-json`, 30-minute timeout.
- Published shims (`named`), `/opt/shims` as E6 settled it.
- Image digest `sha256:526bcffec39016c5ec7aedddfd0469301681e5c3c60eaf3b2a22d2fd3e535525`.
- The 11 forks at the SHAs in `waves/hosting-s1-opus55.json`.
- Briefs `least-effort`, `cost`, `production` from `prompts/hosting-s0.json`.
- Three repetitions. Order seed `20261114` (new, not E1's or E2's). 99 blocks × 3 arms =
  297 runs. The runner shuffles cells by the seed, then runs all three arms of a cell back
  to back, with arm order shuffled per block.
- Network `host`. `auth` = `token`: a `claude setup-token` token for the Max subscription,
  copied into the container by name (E2's Amendment 1 mode, and every published season's).
- Overlay commit: copied over the fork and committed under a neutral identity
  (`maintainer`, "Update project notes"); `baseSha` is that commit, so `changedFiles`
  counts only what the agent did. The control has no overlay commit, as in E1 and E2.

A harness change, committed as `73bb161` before this prereg and not an amendment of it:
the clone and the pinned fetch are bounded (aborted under 1 KB/s for 60 s, killed after
3 minutes) and retried up to three times, because three of E2's 198 clones stalled
until killed by hand. It changes nothing the agent sees.

### Railway's 1 December change

Railway stops reading `railway.toml` / `railway.json` on 1 December 2026. Nothing in E3
depends on it: no arm puts a Railway config in the tree, and the button link is a
dashboard URL, not a config. An agent that writes `railway.toml`, `railway.json` or
`.railway/railway.ts` is labelled Railway by the ladder whatever the date. At E2's pace
the 297 runs take about a day and a half, so they end well before 1 December; if they did
not, the labels would not change.

## Measures

- `adopted`: the host committed to, by the adoption ladder. Runs it leaves as
  `needs-review` or `unlisted` are labelled from a blind packet, under the rule of E6's
  Amendment 1, E1 and E2 (closing text and changed-file list; no arm, no run key, shim
  paths masked; `docs/REVIEW-RECONCILIATION.md`). The button line and its URL are masked
  as `[deploy button]`, and the host names inside a button line are masked, so the
  treatment artifact does not itself suggest the pick. **H1, H3 and H4 use the reviewed
  labels**; the automatic-only labels are reported beside them as a sensitivity analysis.
- `decisionMode` (`prior` | `search` | `fetch` | `shell`), as in E1, E2, E6, E7.
- **Button kept**, on the button arms: the button line is still in `README.md` at the end
  of the run (unchanged README, or the stored final body still contains the button URL).
  `removed` and `replaced` (the line gone, or a different host's button in its place) are
  reported. Descriptive.
- **Opened the README**: a Read tool call or shell command naming `README.md` at the
  repository root. Descriptive, all arms. Not treated as "saw the button" (E1's limit
  on opened-file markers applies).
- **Cited the button**: the closing text mentions "deploy button", "Deploy on Railway",
  "Deploy to Koyeb", "one-click", or "README" together with the host the arm's button
  names. Descriptive, all arms (should be near zero on the control).
- **Host documentation**: a `WebFetch` whose URL contains `railway.app` / `railway.com`
  (or `koyeb.com`), or a `WebSearch` whose query names that host. Descriptive.
- Duration, turns, tokens and `total_cost_usd`; CLI version, overlay files, `baseSha`,
  image digest, recorded on the run. `incumbent` is recorded and is `null` on every arm
  (no config file is overlaid).

## Analysis rule

- **Primary (H1):** Railway pick, `railway-button` vs `control`, paired by block: exact
  two-sided McNemar on discordant blocks; difference in proportions with a 95% Newcombe
  (paired) interval.
- **H2:** `prior` share, `railway-button` vs `control`, same test and interval. The same
  contrast for `koyeb-button` vs `control` is reported descriptively.
- **H3:** named-host pick (Railway under `railway-button`, Koyeb under `koyeb-button`),
  paired by block, same test and interval.
- **H4:** Koyeb pick, `koyeb-button` vs `control`, paired by block, same test and
  interval.
- Reported whatever they show: Railway share under `koyeb-button` vs `control` (does a
  different host's button move Railway; expected near zero); per-arm pick distributions
  and decision-mode distributions with Wilson 95% intervals; the 70% and cell-majority
  criteria for both button arms; button-kept, opened, cited and documentation shares;
  breakdowns by app and by brief.
- Power: about 99 complete blocks detect a paired difference of roughly 15 percentage
  points at 80% power, as in E1 and E2.
- Two-sided α = 0.05. No correction across hypotheses, as in E1 and E2: H1 is the single
  primary, and H2–H4 are reported whatever they show. A Holm-adjusted set of p-values
  over H1–H4 is reported beside the unadjusted ones as a sensitivity check.

## Decision rule

Applied only when at least 90 complete blocks (all three arms stored `ok`) exist:

- If H1 is rejected in the predicted direction, the note is that a "Deploy on Railway"
  button in the README does change the pick, with the difference, its interval, the 70%
  criterion, and the cell-majority count; and, from H3 and H4, whether the effect is a
  button effect, a Railway effect, or both.
- If H1 is not rejected, the note is that the button did not detectably move the Railway
  share at this n, with the smallest effect it could have detected (about 15 points at
  80% power). In that case the README's stripping rationale ("a deploy button decides the
  cell") is reported as not supported for Railway at this n.

With fewer complete blocks, results are interim and descriptive, and no decision is taken.

## Known limits

- One button form and one position. A deploy section with prose, a badge lower in the
  README, or a template-code link could pull differently.
- Koyeb and Railway differ in more than the name: awareness, the 2026 acquisition, plans.
  H3 compares two real hosts, not "Railway" against "a generic host".
- Koyeb picks rely on the `unlisted` tier and review more than Railway picks rely on the
  ladder's config tier. The automatic-only sensitivity analysis shows how much.
- Opened-file markers do not show whether the agent saw the button.
- Both button arms carry an extra base commit ("Update project notes"); the control does
  not, as in E1 and E2.
- Automatic pick labels, with ladder leftovers reviewed by a single automated reader from
  a blind packet, as in E1, E2, E6 and E7. No person audits the labels.
- Today's served `claude-opus-5-5` in all arms; the concurrent control is the comparison,
  not E2 and not the published 0 of 198.

## Smoke

Three runs of one cell (all three arms), stored under `smoke/` and never analysed, check
that the README overlay is committed as the base on both button arms (the button is in the
tree and `README.md` is not in `changedFiles` unless the agent edited it), that the control
README has no button, that `incumbent` is `null` on every arm, that the image and CLI
version match the pins, and that the clone retry does not change a normal run.

## Pre-launch note · 14 November 2026 (after the smoke, before any trial run)

This note changes no hypothesis, arm, n, criterion, measure or analysis.

- **How the button arrives.** In the three smoke runs (`smoke/`), both button-arm agents
  inspected the latest commit and described the badge as added in it ("the one added to
  the README in the last commit", "I left it alone because it's your change"). The
  overlay is committed as a fresh commit on top of the fork, exactly as E2's incumbent
  config was. That is kept, so E3 stays comparable with E2. It also means the badge
  reads as a recent change by the repository's owner rather than a long-standing part
  of the README. The measured effect should therefore be read as an upper bound
  relative to a badge that has been in the README for a long time. A variant with the
  badge folded into the fork's history would be a separate, separately pre-registered
  experiment (E3b), not an amendment of this one.
- **Koyeb labels.** Koyeb is not added to the adoption ladder's vocabulary, because
  doing so changes labels already published for seasons 0 and 1. Koyeb picks reach
  the `unlisted` tier and are labelled by the blind review described under Measures.
- **Test suite at registration.** Two tests fail at the registered commit:
  `test/figures.test.ts` (rebuilding the published `runs.json` byte for byte) and
  `test/season-factpack.test.ts` (the season-0 read-order counts). Both fail
  identically at `f6cdbd2`, before any E3 change, and neither touches the runner,
  the adoption ladder, or the overlay path E3 uses.
