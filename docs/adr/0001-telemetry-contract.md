# ADR-0001: Keep the wrapper's metric names, values and attribute vocabulary

Status: accepted, 2026-09-21
Resolves: CONTEXT.md open decision 1 (instrumentation scope and metric names)

## Context

The retiring statusline wrapper has emitted to `raw.metrics` since 2026-07-17: 32,904 rows. The collector keeps only `claude_code.`-prefixed metrics (cc-otel ADR-0030) and drops the rest as foreign records. Four SQL objects downstream, plus a literal lint key, are written against the wrapper's exact names and attribute spellings.

A new scope or a new metric name is therefore not a naming choice. It is a change to a contract held by a system outside this repo, and it fails silently: records under an unallowed name are dropped, not rejected, so the plugin looks healthy and the mart goes empty.

## Decision

Emit two gauges, names and values unchanged from the wrapper:

| Metric | Value | Datapoint attributes |
| --- | --- | --- |
| `claude_code.usage.utilization` | `asDouble` = `percentUsed` | `window`, `resets_at` |
| `claude_code.usage.reset_in_seconds` | `asDouble` = `ceil((Date.parse(resetsAt) - now) / 1000)` | `window`, `resets_at` |

Both as OTLP **gauges**: `staging.stg_utilization_segments` filters hard on `value_kind = 'gauge_last'`.

`window` is `"5h"` for `five_hour` and `"7d"` for `seven_day`. Only those two have ever reached production, so no other spelling is invented.

Scope name is `cc-otel.plugin`. Nothing filters `scope_name` and the collector's scope condition applies to log conditions only, so the scope is free to name this producer honestly.

Required resource attributes: `service.name = "claude-code"`, `user.email`, `user.account_id`, `session.id`.

Account attributes, one send per session: `seat.tier`, `user.rate_limit_tier`, `organization.rate_limit_tier`, `organization.role`, `organization.type`, `billing.type`, `subscription.created_at`, `extra_usage.enabled`, `profile.fetched_at` (epoch ms, emitted as ISO). `displayName`, `fullName`, `accountCreatedAt`, `ccOnboardingFlags` and the trial fields are not emitted.

`user.rate_limit_tier` is the discriminator to rely on, not `seat.tier`. Claude Code's own Team Premium test reads `subscriptionType === "team" && userRateLimitTier === "default_claude_max_5x"`, and the only tier values in the 2.1.278 binary are `default_claude_max_5x`, `default_claude_max_20x`, `default_claude_zero` and `default_unconfigured`. `seatTier` is a server string that passes through untouched and is compared against no literal anywhere. It is emitted unmapped.

Cost is **not** emitted. `$.session.usage().cost.usd` is available, but cc-otel ADR-0007 already sources cost from official telemetry, and a second writer for one measure is how two numbers come to disagree.

`installer.stamp` and `installer.stamp_on_disk` are dropped. Convergence moves onto the `plugin_loaded` event official telemetry already emits, which measures rollout by the manifest's `version` string. That makes the manifest version load-bearing: it is set and bumped every release. Several plugins in production report an empty version and are unmeasurable as a result.

## Consequences

The existing staging and mart chain keeps working with no collector change on the day the plugin replaces the wrapper. The cost is that the metric names carry the word `usage` and a `claude_code.` prefix that suggests first-party origin; the scope name is what distinguishes this producer.

Renaming anything in the table above is a breaking change to a consumer this repo does not own, and requires the collector's allowance to move first.
