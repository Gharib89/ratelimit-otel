# Phases 1 to 3: understand, classify, implement, verify (detail)

## Contents

- [Phase 2: classify, then implement test-first](#phase-2-classify-then-implement-test-first)
- [Phase 2: delegate execution, keep judgment](#phase-2-delegate-execution-keep-judgment)
- [Phase 2: adjacent finds](#phase-2-adjacent-finds)
- [Verify the spec's external-system claims before building on them](#verify-the-specs-external-system-claims-before-building-on-them)
- [Phase 1 detail: spec precedence](#phase-1-detail-spec-precedence)
- [Phase 3 detail: verify where it failed](#phase-3-detail-verify-where-it-failed)

Phase 2 leads, because classification drives everything downstream; the
phase-1 and phase-3 deep-dives follow.

## Phase 2: classify, then implement test-first

Classify the change into one of three classes. **Announce the class and the
skip path it implies** ("classified `docs`: skipping TDD and phase 3, straight
to the local gate"), so a wrong label is a visible decision now, not a silently
skipped verification later. Later phases refer back to the class by name.

- **`docs`**: markdown, comments, manifest text with no logic. **Skip TDD**
  (no behavior to red-green). Commit `docs:`. Do not manufacture a contrived
  test.
- **`code`**: a feature or bugfix in behavior. Invoke the `tdd` skill
  **autonomously**: red, green, refactor **without pausing for plan approval**
  (you are intentionally overriding tdd's plan-approval checkpoint; the merge
  gate is the review point). A new test goes where the repo's existing tests
  for that area live; a genuinely new test file is registered wherever the
  repo's test runner discovers files, which the local gate's `Small node:`
  syntax tells you.
- **`infra`**: tooling or a refactor where a strict red-green is awkward, the
  change *is* the build, CI, a fixture or the test harness. Do not force a
  contrived red. Extract the logic into a testable seam and unit-test its
  **observable behavior** through that seam; the real run in phase 3 is the
  integration proof.

When in doubt between `code` and `docs`, treat it as `code` and write the test.

**Tripwires are not a class.** Whatever the class, the profile's `Tripwires:`
(a bundle to rebuild and commit, a generated artifact to regenerate) and its
`In-PR requirement:` (a version bump a CI gate enforces) land in the same
change, or a later phase goes red with no phase explaining why.

## Phase 2: delegate execution, keep judgment

Phase 2 fuses two kinds of work. **Judgment** (the classification, the lane
keys, spec interpretation, external-claim probes, design choices, the brief)
stays in the main thread on the judgment tier. **Execution** (writing the
failing test, making it green, refactoring, from a plan the main thread set) is
mechanical-tier work: delegate it to ONE subagent when the plan is settled and
the change is bounded. Keep it inline when the issue is exploratory, the spec
is still settling, or the change touches schema or architecture; a
plan-implement feedback loop across a subagent boundary loses too much. The
phase-4 Standards review on the full diff is the safety net either way.

Hand the subagent: the worktree path, its `execute` scratch directory, the
plan, the test command, and the repo conventions the edit needs. Require back:
a diff summary, the test files and cases added or updated, and a **structured
deviations list**; it lands verbatim in the merge summary, and a subagent that
fixes-and-forgets loses it. Two hard rules
in its prompt:

- Every Edit/Write path carries the **worktree prefix**; an absolute
  main-checkout path silently edits the wrong tree. After its first edit,
  `git -C <main-checkout> status` must be clean.
- It runs only the **targeted test nodes**; the phase-5 gate stays with the
  orchestrator.

## Phase 2: adjacent finds

A find outside the issue takes one of three dispositions and no fourth, and
phases 4 and 7 send their own out-of-scope findings back here.

- **Fix it inline** and log the deviation, where an acceptance criterion names
  it, the fix lands in a file this PR already changes, or a reviewer of this PR
  would flag it.
- **`file-issue` it** with the profile's triage marker and leave it. The
  mechanic answers `filed: false` with candidates when an open issue's title
  shares three or more tokens with yours, and each candidate is **read**: the
  same finding is linked in the deviations log rather than refiled, and
  `comment-issue` posts any evidence this run adds to it; a different one is
  refiled with `--distinct-from`.
- **Stop `mis-specified`**, where the find shows the issue itself is wrong.

The merge summary lists every issue filed and every candidate linked.

## Verify the spec's external-system claims before building on them

When the issue asserts a *causal mechanism* about something outside this
repo's code (a library behavior, a platform's response, an OS path rule),
treat it as a **hypothesis, not a fact**, and confirm it against the real thing
with the cheapest possible probe *before* writing the fix around it. The
profile's `Claims to probe:` lines are this repo's examples of the kind. A
triage brief's root cause is frequently a plausible guess; building on a wrong
one means implementing, having phase 3 disprove it, and rebuilding. A probe
that contradicts the brief is an early stop-and-report (`mis-specified`), not a
phase-3 surprise.

## Phase 1 detail: spec precedence

A later triage brief or authoritative comment can *supersede* the issue body.
When they conflict (scope reduced, an option chosen, an axis dropped), the
latest authoritative spec wins and the body's original acceptance criteria no
longer bind. Note it in the deviations log so the merge summary carries it, and
expect a reviewer reading the stale body to flag "missing" requirements; reject
those in phases 4 and 7 with the comment as evidence.

## Phase 3 detail: verify where it failed

Each entry under `## Verification` has seven lines. You judged `Applies when:`
at classification; here you run the applicable ones.

- **Run** its `Run:` line scoped to what you touched, the phase-2 regression
  test in that run and the rest of the suite left to the local gate. Pass is
  generic: green for the touched scope on the named environment. There is no
  per-verification pass rule.
- **Where.** On the environment the issue was reported against. A different
  environment may auto-heal the bug, so green is not fixed unless it is green
  where it failed. Where this machine cannot prove the claim (an OS the issue
  names, a matrix leg), `Also proven by CI:` names the leg that does; write the
  test so that leg proves it and watch it in phase 8.
- **Prerequisite missing** (`Needs:` fails its detection): the disposition is
  the entry's `Without it:` line, one of:
  - `hand-off`: attended, print the exact command and setup, wait for the human
    to run or confirm it, resume; the claim holds. Unattended: hand back with
    the same command in the reason.
  - `defer-to-ci`: continue; legal only because `Also proven by CI:` names a
    leg, which the merge summary then names. The only unattended-safe
    disposition.
  - `blocked`: cannot be verified anywhere without the prerequisite. Stop
    `blocked-verification`.
- **Result words** are the local gate's plus `unexercised`: `pass | fail |
  deferred-to-ci | unavailable | unexercised`. The fifth is phase 3's alone,
  because a gate check always has a subject. Phase 5 admits `pass`,
  `deferred-to-ci` and `unexercised` only, so a verification still without a
  result is finished here, by running it or by taking its `Without it:` line;
  the merge gate is for reading a summary, not finishing phase 3.
- **`unexercised`** is the verification whose `Needs:` were satisfied and whose
  every applicable path lacked a **subject** to drive, where the subject is one
  another actor creates (a reviewer's thread on this run's PR), as opposed to
  one ship could have created itself. The human weighs it at the merge gate,
  where [merge-gate.md](merge-gate.md) says how the row reads, and an unattended
  run proceeds on it, because there is nothing to hand back for. Three cases it
  is the wrong word for: a **prerequisite** that failed its detection, which
  `Without it:` still owns; a path the run **skipped**, which is an unrun
  verification; and a verification where **at least one applicable path ran**,
  which is unchanged, the paths that ran giving the result and `<what ran>`
  naming the unexercised one.
- `docs` class and the small lane skip this phase entirely.
