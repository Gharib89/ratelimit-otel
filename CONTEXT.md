# ratelimit-otel

A Claude Code plugin that exports **rate-limit window utilization** as OTLP. Claude Code's own OTel exporter ships eight metrics and none of them carries this; the number exists only behind `/usage`. The plugin replaces a per-machine statusline wrapper and its installer, so a seat needs no Node on PATH, no statusline and no local artifact: the endpoint and the bearer are read from the console telemetry env block at send time ([ADR-0004](docs/adr/0004-transport-reads-the-console-env-block.md)).

Scope discipline: anything Claude Code already exports is out of scope here. Cost in particular is available on `$.session.usage()` and is deliberately not emitted ([ADR-0001](docs/adr/0001-telemetry-contract.md)).

## Ubiquitous language

Use these terms in issue titles, test names, metric labels and ADRs. Where a term below differs from the one a neighbouring system uses, this file wins inside this repo and the boundary is named in the entry.

- **Window** — a rate-limit period the account is measured against. Two kinds, `five_hour` and `seven_day`, emitted as `5h` and `7d`. A window is identified by its `resets_at`, not by its kind alone: when a window rolls over, the next one is a new series, and reading it as the same series turns a rollover into a drop to zero.
- **`spend_limit`** — not a window. It arrives in the same `rateLimits` array in place of the two time windows behind a gateway provider, and it measures dollars. It is skipped, never mapped onto a window spelling.
- **Utilization** — `percentUsed` for a window, 0 to 100. The single quantity this plugin exists to export.
- **Account-wide** — true of every rate-limit reading. Concurrent sessions on one account all report the same numbers, so readings are aggregated with **max** per `(account, kind, resets_at)` and never summed. "Per session" is not a thing a window has. Aggregation belongs to the consumer: this repo emits every sample and neither deduplicates nor smooths ([ADR-0003](docs/adr/0003-sample-every-session-with-an-identity-ladder.md)).
- **Sample** — one read of `$.session.usage()` and the OTLP record it produces. Taken on a periodic clock and after a turn completes, because a window reflects the last API response and has nothing to report before one lands.
- **Delivery floor** — the five minutes that must pass between one seat's deliveries. Not a smoothing step: a volume bound, because the plugin runs in every session on every seat rather than in one terminal. The mechanism is `$.store`, the plugin's own key-value store, which the engine already keeps between sessions and hot reloads: one `get` and one `set` of `last_delivery_at`, so there is no state file, no lock and no atomicity work of this repo's own. Two concurrent sessions can lose an update to each other and the worst case is one extra delivery. The store's file name carries the install identity, so a floor carried across a change of install method is not something to rely on.
- **Identity ladder** — the three-rung read that gives a sample its `user.email`: `~/.claude.json`, then `OTEL_RESOURCE_ATTRIBUTES`, then `CLAUDE_USER_EMAIL`. A CI run has no `oauthAccount` on disk, and a sample with no email is still emitted. The ladder governs the email alone: `user.account_id` is read off `~/.claude.json` whenever the file carries one, because neither later rung can supply it.
- **Seat** — one machine-and-user running Claude Code. The unit the fleet is counted in and the unit a config reaches.
- **Instrumentation scope** — the OTel scope the records carry, `cc-otel.plugin`. A boundary term: the downstream collector keeps only records whose metric prefix it already allows and drops the rest as foreign, silently, so the emit contract is held with a system outside this repo.
- **Transport** — how a sample leaves the process: a POST of OTLP JSON to `<endpoint>/v1/metrics`, the endpoint and the `Authorization` header read at send time from the **console telemetry env block**, the org console policy's env settings that also configure Claude Code's own exporter. The plugin holds no endpoint and no credential of its own, and a scope the block does not reach sends nothing ([ADR-0004](docs/adr/0004-transport-reads-the-console-env-block.md)).
- **Manifest version** — the `version` string in `plugin/.claude-plugin/plugin.json`. Load-bearing, not bookkeeping: the fleet's rollout is measured off the `plugin_loaded` event's version, so a release that does not bump it is unmeasurable. Several plugins in production report an empty version.
- **Silent no-op** — the plugin's characteristic failure. Without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` the hooks module does not load and nothing reports it: no error, no log, no records. The flag now ships fleet-wide in the org console policy env block, but it remains the first hypothesis for "nothing happened", not the last. It has a second shape: where the console policy does not reach a scope, `OTEL_EXPORTER_OTLP_ENDPOINT` is unset or empty, the sample is skipped rather than retried, and again nothing reports it ([ADR-0004](docs/adr/0004-transport-reads-the-console-env-block.md)).

## Decisions

The emit contract is settled. Read these before changing anything that leaves the process:

- [ADR-0001](docs/adr/0001-telemetry-contract.md) — metric names, values, scope and attributes. Names are a contract with the collector, and a wrong one is dropped silently rather than rejected.
- [ADR-0002](docs/adr/0002-emit-both-the-instant-and-the-countdown.md) — `reset_in_seconds` stays a metric and `resets_at` is added as an attribute, so the producer can change before the consumer.
- [ADR-0003](docs/adr/0003-sample-every-session-with-an-identity-ladder.md) — sample every session including CI, with an identity ladder and a five-minute delivery floor. Amended: a cloud sandbox is unreachable by measurement.
- [ADR-0004](docs/adr/0004-transport-reads-the-console-env-block.md) — the transport reads the console telemetry env block, POSTs OTLP JSON, and skips where there is no endpoint. No config artifact, no credential in this repo.

## Where this is going

Build for **one seat**: a version installable with `--plugin-dir` and correct on one machine. The cc-otel database tickets are held until real rows land in `raw.metrics`, and the schema is decided from those rows rather than ahead of them.

Distribution is manual until the org console carries `enabledPlugins` and `extraKnownMarketplaces`; the policy env block already carries `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`. No marketplace work is needed yet.
