# ratelimit-otel

A Claude Code plugin that exports **rate-limit window utilization** as OTLP. Claude Code's own OTel exporter ships eight metrics and none of them carries this; the number exists only behind `/usage`. The plugin replaces a per-machine statusline wrapper and its installer, so a seat needs no Node on PATH, no statusline and no local artifact.

Scope discipline: anything Claude Code already exports is out of scope here.

## Ubiquitous language

Use these terms in issue titles, test names, metric labels and ADRs. Where a term below differs from the one a neighbouring system uses, this file wins inside this repo and the boundary is named in the entry.

- **Window** — a rate-limit period the account is measured against. Two kinds today, `five_hour` and `seven_day`, and `spend_limit` in place of both behind a gateway. A window is identified by its `resetsAt`, not by its kind alone: when a window rolls over, the next one is a new series, and reading it as the same series turns a rollover into a drop to zero.
- **Utilization** — `percentUsed` for a window, 0 to 100. The single quantity this plugin exists to export.
- **Account-wide** — true of every rate-limit reading. Concurrent sessions on one account all report the same numbers, so readings are aggregated with **max** per `(account, kind, resetsAt)` and never summed. "Per session" is not a thing a window has.
- **Sample** — one read of `$.session.usage()` and the OTLP record it produces. Taken on a periodic clock and after a turn completes, because a window reflects the last API response and has nothing to report before one lands.
- **Seat** — one machine-and-user running Claude Code. The unit the fleet is counted in and the unit a config reaches.
- **Instrumentation scope** — the OTel scope the records carry. A boundary term: the downstream collector keeps only records whose scope and metric prefix it already allows and drops the rest as foreign, so the scope is a contract with a system outside this repo, not a local naming choice.
- **Silent no-op** — the plugin's characteristic failure. Without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` the hooks module does not load and nothing reports it: no error, no log, no records. Named because it is the first hypothesis for "nothing happened", not the last.

## Open decisions

Three decisions belong to the downstream consumer (the cc-otel collector, its staging views and its ADRs), not to this repo. Each blocks work here. Do not settle one locally: ask cc-otel, then record the answer as an ADR under `docs/adr/` and delete the entry from this list.

### 1. Instrumentation scope and metric names

**Blocks:** anything that emits. **Decided by:** cc-otel's collector allowance (ADR-0030 there).

The collector attests by keeping only Claude Code's instrumentation scope and the `claude_code.` metric prefix, dropping everything else as a foreign record. The retiring wrapper emitted `claude_code.usage.utilization` (gauge, percent 0-100) and `claude_code.usage.reset_in_seconds` under scope `cc-otel.statusline`, labelled `user.email`, `session.id`, `window`.

Reusing that exact shape keeps the existing staging and mart chain working unchanged. Any new scope name needs the collector's allowance updated **before** the plugin emits under it, or every record is silently dropped. Do not invent a scope.

### 2. `resetsAt` as a timestamp, or `reset_in_seconds` as a countdown

**Blocks:** the payload shape, and therefore decision 1. **Decided by:** cc-otel's schema owner.

The engine hands back `resetsAt` as an ISO-8601 instant. The existing `staging.stg_utilization_segments` reconstructs that instant from a countdown plus the record's timestamp and bins it to five minutes. Emitting the instant directly would let that view get simpler, but it is a schema change downstream, so the simplification is not free and is not this repo's to take.

### 3. Whether to sample on CI and cloud sessions

**Blocks:** the sampler's start condition. **Decided by:** cc-otel, on what the mart should count.

Sessions on a GitHub Actions runner or a cloud sandbox carry `terminal_type = non-interactive` and, today, no `user.email`. They consume the same account-wide windows as a human seat, so excluding them loses real utilization; including them adds rows no seat-level view can attribute. Open either way.
