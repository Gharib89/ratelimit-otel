# Ship profile

Schema: 3

Every repo-specific fact `/ship` needs, one section per axis. Fourteen `##` headings, always present and in this order; a defaulted axis reads `None.` or `Default.` under its own heading. Facts sit on `Label:` lines and nowhere else, and the prose under a heading explains them. The `Schema:` line above is the profile schema `ship` checks at preflight; only a `setup-skills` re-run moves it.

## Host

Host: github

## Worktree

Carry: None.
Bootstrap: npm ci && claude -p "/plugin-types"

`.claude/types/*.d.ts` is generated, gitignored, and the authority this repo typechecks against, so a fresh worktree has none. `claude -p "/plugin-types"` regenerates it with no interactive session. Without this step the typecheck gate fails on every symbol in the module.

## Local gate

Location: scripts/local-gate.sh
Small node: `.`, the plugin directory. Docs-class: the path of the changed document, e.g. `docs/adr/0001-metric-scope.md`.
Tripwires: None.

`claude plugin test <dir>` loads the plugin from `<dir>` as well as scanning it for tests, so a directory below the plugin root is refused (`no hooks module to load`) rather than run as a narrower node. The plugin root is the repo root here, so `.` is the only node the runner takes and the small lane narrows nothing on the tests gate: its saving is the gates a docs-class node skips. Keep test files in the directory their subject lives in.

## CI

Legs: None.
No-checks legal: yes; this repo has no `pull_request` workflow at all, so no PR will ever report a check. With `Legs: None.` that is the pair dropping `ci-wait`'s no-checks grace to zero.
Push policy: Default.

The repo is public, so Actions minutes are unmetered and nothing argues for batching pushes. Every check therefore runs in the local gate. When a PR workflow lands, re-run `/setup-skills` so the legs and any `defer-to-ci` verification move together.

## Reviewers

### Copilot

Login: copilot-pull-request-reviewer[bot]
Trigger: on-request
Request: None.
Workflow: None.
Cap: 3
Resolve: resolve-thread
Gating: yes
Fallback-for: None.
Instructions: .github/copilot-instructions.md

No `copilot_code_review` rule exists on `main`, so the host answers `review_on_push: false` and only `on-request` or `auto-once` is admissible; `on-push` would make preflight refuse this profile. The PR's own opening round is round 1, and ship buys the remaining two with the host's request-a-reviewer call. Enabling the rule with `review_on_push: true` later is a profile change, not just a setting change.

## Coding standards

docs/contributing/coding-standards.md

## Verification

### OTLP export to a real collector

Proves: the hook's OTLP POST reaches a collector carrying the instrumentation scope, metric names and label keys the downstream collector attests on, rather than the shape a mock accepted.
Applies when: the change touches what is emitted or how it is sent: metric names, scope, units, label keys, payload assembly, or the `$.http.fetch` call.
Run: start an OTLP listener on 127.0.0.1:4318, then `claude -p "<prompt>" --plugin-dir .` with `OTEL_EXPORTER_OTLP_ENDPOINT` pointed at it, and read the received payload.
Needs: a listener on 127.0.0.1:4318; detect with a connect probe before running.
Without it: hand-off
Also proven by CI: None.
Claims to probe: that a POST from inside a hook returns 2xx; that `$.http.fetch` is not blocked here by the `allow_web_fetch` policy or by session-level nonessential-traffic disablement.

### Live session usage read

Proves: `$.session.usage()` populates `rateLimits` against a real session with the kinds and fields the code assumes, rather than the fixture a test asserted on.
Applies when: the change touches what is read off `$.session.usage()`, the sampler's timing, or how absent or unexpected `rateLimits` entries are handled.
Run: `claude -p "<a prompt that draws one API response>" --plugin-dir .` with the sampler logging what it read.
Needs: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` truthy in settings that outrank process env; detect by asserting the hook ran at all, because its absence is a silent no-op and not an error.
Without it: hand-off
Also proven by CI: None.
Claims to probe: that `rateLimits` is empty at `session.start` and populates only after an API response; that `kind` is one of `five_hour`, `seven_day` or `spend_limit`; that `resetsAt` may be absent.

## Versioning and changelog

Tooling: semantic-release
Reads: the squash subject
In-PR requirement: None.
Subject constraints: Conventional Commits, the type matching the issue's Kind dimension label (`fix`, `feat`, `docs`, `refactor`, `chore`).

The release job bumps `.claude-plugin/plugin.json` and `marketplace.json` and tags. `claude plugin tag` refuses when those two disagree, so they move together in the release commit and never in a PR. That workflow does not exist yet.

## PR

Template: .github/pull_request_template.md

## Public surface

- The emitted telemetry contract: instrumentation scope, metric names, type and unit, and label keys. A consumer outside this repo keeps only records matching these and drops the rest, so a rename breaks it silently.
- `.claude-plugin/plugin.json`: name, version, and the `userConfig` schema a seat configures against.
- `marketplace.json`: the entry the org console requires by name and pins by version.
- The set of environment variables the module reads, which `claude plugin validate` prints and the console's env block must supply.

## Triage

File as an issue labelled `needs-triage`.

## Docs sync

Targets: README.md, .claude/CLAUDE.md, CONTEXT.md, docs/, docs/adr/
Agent-facing: .claude/CLAUDE.md, docs/agents/, .claude/skills/

## Current docs

Sources: context7
Pinned: Claude Code 2.1.278; the plugin API is early access and moves between releases.

The authority for the plugin API is `.claude/types/claude-code.d.ts`, regenerated with `claude -p "/plugin-types"`. It is not context7 and not code.claude.com, which does not document function hooks at all: a docs search on this API returns confident wrong answers. Use context7 for everything else, and the `plugin-authoring` skill for the `($, e, next)` contract.

## Cloud lane

PR cap: 3
Bootstrap: None.
