# ratelimit-otel

A Claude Code plugin that exports **rate-limit window utilization** as OTLP. Claude Code's own OTel exporter ships eight metrics and none of them carries this; the number exists only behind `/usage`. The plugin replaces a per-machine statusline wrapper and its installer, so a seat needs no Node on PATH, no statusline and no local artifact.

Scope discipline: anything Claude Code already exports is out of scope here. Cost in particular is available on `$.session.usage()` and is deliberately not emitted ([ADR-0001](docs/adr/0001-telemetry-contract.md)).

## Ubiquitous language

Use these terms in issue titles, test names, metric labels and ADRs. Where a term below differs from the one a neighbouring system uses, this file wins inside this repo and the boundary is named in the entry.

- **Window** — a rate-limit period the account is measured against. Two kinds, `five_hour` and `seven_day`, emitted as `5h` and `7d`. A window is identified by its `resets_at`, not by its kind alone: when a window rolls over, the next one is a new series, and reading it as the same series turns a rollover into a drop to zero.
- **`spend_limit`** — not a window. It arrives in the same `rateLimits` array in place of the two time windows behind a gateway provider, and it measures dollars. It is skipped, never mapped onto a window spelling.
- **Utilization** — `percentUsed` for a window, 0 to 100. The single quantity this plugin exists to export.
- **Account-wide** — true of every rate-limit reading. Concurrent sessions on one account all report the same numbers, so readings are aggregated with **max** per `(account, kind, resets_at)` and never summed. "Per session" is not a thing a window has. Aggregation belongs to the consumer: this repo emits every sample and neither deduplicates nor smooths ([ADR-0003](docs/adr/0003-sample-every-session-with-an-identity-ladder.md)).
- **Sample** — one read of `$.session.usage()` and the OTLP record it produces. Taken on a periodic clock and after a turn completes, because a window reflects the last API response and has nothing to report before one lands.
- **Delivery floor** — the five minutes that must pass between one seat's deliveries. Not a smoothing step: a volume bound, because the plugin runs in every session on every seat rather than in one terminal.
- **Identity ladder** — the three-step read that gives a sample its `user.email`: `~/.claude.json`, then `OTEL_RESOURCE_ATTRIBUTES`, then `CLAUDE_USER_EMAIL`. A CI run has no `oauthAccount` on disk, and a sample with no email is still emitted.
- **Seat** — one machine-and-user running Claude Code. The unit the fleet is counted in and the unit a config reaches.
- **Instrumentation scope** — the OTel scope the records carry, `cc-otel.plugin`. A boundary term: the downstream collector keeps only records whose metric prefix it already allows and drops the rest as foreign, silently, so the emit contract is held with a system outside this repo.
- **Manifest version** — the `version` string in `.claude-plugin/plugin.json`. Load-bearing, not bookkeeping: the fleet's rollout is measured off the `plugin_loaded` event's version, so a release that does not bump it is unmeasurable. Several plugins in production report an empty version.
- **Silent no-op** — the plugin's characteristic failure. Without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` the hooks module does not load and nothing reports it: no error, no log, no records. The flag now ships fleet-wide in the org console policy env block, but it remains the first hypothesis for "nothing happened", not the last.

## Decisions

The emit contract is settled. Read these before changing anything that leaves the process:

- [ADR-0001](docs/adr/0001-telemetry-contract.md) — metric names, values, scope and attributes. Names are a contract with the collector, and a wrong one is dropped silently rather than rejected.
- [ADR-0002](docs/adr/0002-emit-both-the-instant-and-the-countdown.md) — `reset_in_seconds` stays a metric and `resets_at` is added as an attribute, so the producer can change before the consumer.
- [ADR-0003](docs/adr/0003-sample-every-session-with-an-identity-ladder.md) — sample every session including CI, with an identity ladder and a five-minute delivery floor.

## Where this is going

Build for **one seat**: a version installable with `--plugin-dir` and correct on one machine. The cc-otel database tickets are held until real rows land in `raw.metrics`, and the schema is decided from those rows rather than ahead of them.

Distribution is manual until the org console carries `enabledPlugins` and `extraKnownMarketplaces`; the policy env block already carries `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`. No marketplace work is needed yet.
