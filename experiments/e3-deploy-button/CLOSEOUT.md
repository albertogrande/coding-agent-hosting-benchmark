# E3 · Closed without a result

Closed on 18 November 2026. No trial run of this experiment is stored in this record.

- **Registered:** 14 November 2026, in `prereg.md` (commit `87255ab`).
- **Planned:** 297 runs, three groups of 99: no button, a "Deploy on Railway" button and a
  "Deploy on Koyeb" button in each app's README.
- **Run:** three smoke runs on one app and brief, in `smoke/`. Smoke runs check the
  instrument and are never analysed.
- **Result:** none. Nothing here measures what a deploy button does to the pick.

## Why it was closed

The study ended on 18 November 2026 with E1 and E2 as its tests of a repo that names a host.

The design also had a flaw that showed before any trial run. Three of the 11 forks carry a
`FORK-NOTES.md` at their root saying that their deploy sections and buttons were removed
(`method/REPOSITORIES.md`). A new button in the README of those forks contradicts the
repo's own notes. An agent that reads both sees a mixed signal, so those three apps would
not have tested a button on its own.

A fair version would add the button to forks with no such note, or fold it into the fork's
history. That would be a new experiment with its own registration, not an amendment of
this one.

## What the write-up may say

That a deploy button was not measured. Nothing more.
