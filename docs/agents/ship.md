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
Small node: `plugin`, the plugin root. Docs-class: the path of the changed document, e.g. `docs/adr/0001-metric-scope.md`.
Tripwires: None.

`claude plugin test <dir>` loads the plugin from `<dir>` as well as scanning it for tests, so a directory below the plugin root is refused (`no hooks module to load`) rather than run as a narrower node. `plugin` is therefore the only node the runner takes: a code-class small node runs the full lane verbatim, and only a docs-class node saves anything, skipping every code-class gate. A test file goes inside the plugin tree, under a directory `tsconfig.json`'s `include` names (`plugin/hooks`): the gate runs and counts tests there and nowhere else, so one outside it is neither typechecked nor run.

## CI

Legs: None.
No-checks legal: yes; no workflow triggers on `pull_request`, so no PR will ever report a check. With `Legs: None.` that is the pair dropping `ci-wait`'s no-checks grace to zero.
Push policy: Default.

The repo is public, so Actions minutes are unmetered and nothing argues for batching pushes. Every check a PR is judged on therefore runs in the local gate. `.github/workflows/release.yml` is deliberately not a leg: it runs on `main` after the merge, a ref no PR head shares, so a `Legs:` entry naming it would leave `ci-wait` waiting for a check that never arrives. When a `pull_request` workflow lands, re-run `/setup-skills` so the legs and any `defer-to-ci` verification move together.

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

The repository ruleset `copilot-review-on-open` carries a `copilot_code_review` rule with `review_on_push: false` scoped to `~DEFAULT_BRANCH`, so the host answers `review_on_push: false` and only `on-request` or `auto-once` is admissible; `on-push` would make preflight refuse this profile. The rule still draws a round when the PR opens, and `on-request` is the trigger that makes that free round the loop's round 1: `Cap: 3` buys the remaining two through the host's request-a-reviewer call, which needs no comment phrase, so `Request:` reads `None.`. `auto-once` would take the opening round and stop there. The rule leaves `review_draft_pull_requests: false`, which costs nothing here because `open-pr` opens non-draft PRs. Flipping `review_on_push` back to `true` is a profile change, not just a setting change.

## Coding standards

docs/contributing/coding-standards.md

## Verification

### OTLP export to a real collector

Proves: the hook's OTLP POST reaches a collector carrying the instrumentation scope, metric names, metric type and label keys the downstream collector attests on, rather than the shape a mock accepted.
Applies when: the change touches what is emitted or how it is sent: metric names, scope, units, label keys, payload assembly, or the `$.http.fetch` call.
Run: `claude -p "<prompt>" --plugin-dir plugin --debug-file <log> < /dev/null`, then read the result back **at the collector**: run the read-only query the repo's `CLAUDE.md` carries under **Verifying a delivery landed**, and assert that scope `cc-otel.plugin` holds `claude_code.usage.utilization` with a `max(ts)` later than the run, one row per `usage_window` the run sampled, plus `claude_code.usage.reset_in_seconds` for every window whose `resetsAt` was present, every row carrying `metric_type` `gauge` and `value_kind` `gauge_last`. ADR-0001 fixes the two names; `usage_window` is the `window` datapoint attribute as the collector stores it, and a window with no `resetsAt` emits utilization alone, so one name is a finding only where the sampled window carried one.
Needs: read access to cc-otel's `raw.metrics`, and a seat the **console telemetry env block** reaches, which is what supplies the endpoint. Probe the read access **first**, with the TCP probe in the same `CLAUDE.md` section: both ways round a blocked probe need a human, so blocked is the `Without it:` path below rather than a round to spend. The seat is read off `<log>` after the run, by asserting a `POST` line, since a seat the block does not reach logs nothing at all.
Without it: hand-off
Also proven by CI: None.
Claims to probe: that a POST from inside a hook returns 2xx; that `$.http.fetch` is not blocked here by the `allow_web_fetch` policy or by session-level nonessential-traffic disablement. Both are open. Settled and not among them, so it is not re-asked: the env precedence measured 2026-09-21, recorded in `../contributing/coding-standards.md` under the missing-flag entry, which leaves no override route pointing this plugin at a local listener.

The type is asserted because ADR-0001 makes it load-bearing outside this repo: `staging.stg_utilization_segments` filters hard on `value_kind = 'gauge_last'`, so a record arriving as a sum satisfies every other assertion here and then drops out of the mart with nothing reporting it. The unit is the one axis of `## Public surface` no read-back reaches: `raw.metrics` stores no unit column (measured 2026-09-22), so this entry cannot assert it and does not pretend to.

`<log>` is a supporting read, never the proof: a `$.http.fetch (ratelimit-otel): POST <endpoint>/v1/metrics` line and a 2xx say a request was accepted, and the collector attests every record and silently drops a foreign one (cc-otel ADR-0030), so a green POST with no row is the failure this entry exists to catch. An unreachable database is the other empty answer, which is why the probe runs first: an unprobed empty query cannot tell a dropped record from a database it never reached. `-p --debug` alone prints nothing, and without `< /dev/null` the run waits on stdin. To read the payload itself rather than the row, run a copy of the plugin that logs it before the POST. Each run starts clean: the movement gate is in memory, per session (ADR-0005), so every fresh `claude -p` delivers its first reading from `session.measure`, each whole-point move adds a POST, and `session.end` POSTs only for a movement that has not landed by exit. Count POST lines as attempts, not as health: an exit POST means the `session.measure` one was refused or still in flight, and both can land. The row is the verdict. When the change touches `session.end`, read back a run whose `<log>` shows a POST just before the `session.end settled in` line: a `max(ts)` at or after that POST's time is the exit sample's row.

### Live session usage read

Proves: `$.session.usage()` populates `rateLimits` against a real session with the kinds and fields the code assumes, rather than the fixture a test asserted on.
Applies when: the change touches what is read off `$.session.usage()`, the sampler's timing, or how absent or unexpected `rateLimits` entries are handled.
Run: `claude -p "<a prompt that draws one API response>" --plugin-dir plugin` with the sampler logging what it read.
Needs: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` truthy from a source that outranks process env, which on a fleet seat is the console telemetry env block: it carries the flag alongside the OTEL names, and no process-env or `--settings` value overrides it (the precedence measurement recorded in `../contributing/coding-standards.md` under the missing-flag entry). On a seat that block does not reach, user settings supply it. Unlike the OTEL names it does reach child processes, so a Bash child can read it. Detect by asserting the hook ran at all, because its absence is a silent no-op and not an error.
Without it: hand-off
Also proven by CI: None.
Claims to probe: that `rateLimits` is empty at `session.start` and populates only after an API response; that `kind` is one of `five_hour`, `seven_day` or `spend_limit`; that `resetsAt` may be absent.

## Versioning and changelog

Tooling: semantic-release
Reads: the squash subject
In-PR requirement: None.
Subject constraints: Conventional Commits, the type matching the issue's Kind dimension label (`fix`, `feat`, `docs`, `refactor`, `chore`).

`.github/workflows/release.yml` runs semantic-release on a push to `main`, which grades the bump from the squash subject, writes the manifest version, tags `ratelimit-otel--v<version>` and publishes the **release archive** on a GitHub Release for that tag (ADR-0006); `.releaserc.json` has the steps. A PR therefore carries no version edit. `claude plugin tag` runs in the release as the agreement gate: it refuses when the manifest and an enclosing marketplace entry disagree, so the two move together in the release commit and never in a PR. The release's prepare step also refuses a first build whose `plugin.json` differs from the manifest it then commits; the zip it uploads is rebuilt from the release commit and passes the same layout check, which the local gate's `archive` gate also runs. The repo carries `.claude-plugin/marketplace.json`, whose entry carries no `version` (CONTEXT.md, **Where this is going**), so today the gate has nothing that can drift. The local gate's `tag` gate runs the same call, so a version added to the entry later fails the PR rather than the release on `main`.

## PR

Template: .github/pull_request_template.md

## Public surface

- The emitted telemetry contract: instrumentation scope, metric names, type and unit, and label keys. A consumer outside this repo keeps only records matching these and drops the rest, so a rename breaks it silently.
- `plugin/.claude-plugin/plugin.json`: name, version, and the `userConfig` schema a seat configures against.
- `.claude-plugin/marketplace.json`: the marketplace `name` and the entry's `name`, which are the coordinate `claude plugin install ratelimit-otel@ratelimit-otel` resolves and the org console pins in `extraKnownMarketplaces` and `enabledPlugins`, so renaming either orphans every installed seat; and the entry's `source`, the path the plugin is read from.
- The **release archive** (ADR-0006): the asset names `ratelimit-otel-<version>.zip` and `ratelimit-otel-<version>.zip.sha256`, which with the tag `ratelimit-otel--v<version>` compose the download URL ADR-0006 gives; the zip's layout (`.claude-plugin/plugin.json` and `hooks/hooks.json` at its root); and the `` - sha256: `<hex>` `` line `scripts/release-archive.sh build` writes into the release notes. The operator copies the URL and `sha256` from the release into the console entry, and a seat installs from the zip's root, so changing any of these breaks the next rollout.
- The set of environment variables the module reads, which `claude plugin validate` prints and the console's env block must supply.

## Triage

File as an issue labelled `needs-triage`.

## Docs sync

Targets: README.md, CLAUDE.md, CONTEXT.md, docs/, docs/adr/
Agent-facing: CLAUDE.md, docs/agents/, .claude/skills/

## Current docs

Sources: context7
Pinned: Claude Code 2.1.278; the plugin API is early access and moves between releases.

The authority for the plugin API is `.claude/types/claude-code.d.ts`, regenerated with `claude -p "/plugin-types"`. It is not context7 and not code.claude.com, which does not document function hooks at all: a docs search on this API returns confident wrong answers. Use context7 for everything else, and the `plugin-authoring` skill for the `($, e, next)` contract.

## Cloud lane

PR cap: 3
Bootstrap: None.
