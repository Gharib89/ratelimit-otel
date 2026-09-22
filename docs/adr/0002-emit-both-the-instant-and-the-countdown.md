# ADR-0002: Emit both the reset instant and the countdown

Status: accepted, 2026-09-21; formula amended 2026-09-22 (see Amendment)
Resolves: CONTEXT.md open decision 2 (`resetsAt` versus `reset_in_seconds`)
Refines: [ADR-0001](0001-telemetry-contract.md)

## Context

`$.session.usage()` hands back `resetsAt` as an ISO-8601 instant. The wrapper never had it: it emitted `claude_code.usage.reset_in_seconds`, a countdown, and `staging.stg_utilization_segments` reconstructs the window end from that countdown plus the record's timestamp, binned to five minutes.

The open question was whether to replace the countdown with the instant. Replacing it outright is a downstream schema change, and the reconstruction is what every existing row was built from.

## Decision

Emit both, in different positions:

- `claude_code.usage.reset_in_seconds` stays a metric, computed as `ceil((Date.parse(resetsAt) - now) / 1000)`. Every existing row and view keeps its meaning.
- `resets_at` is added as a **datapoint attribute** on both metrics, the ISO string verbatim from `$.session.usage()`.

The attribute is additive: a consumer that ignores it is unaffected, and the staging view can stop reconstructing the window end whenever its owner chooses to, without this repo shipping anything on that day.

## Consequences

The instant is carried twice, once exactly and once as a derived countdown that loses precision to the five-minute bin. That redundancy is deliberate and temporary: it is what lets the producer change before the consumer.

It also makes the window's identity explicit on the wire. A window is identified by `resets_at`, so a rollover is visible as a new value rather than inferred from a countdown that jumped, which is the failure the countdown alone could not distinguish from a drop to zero.

This ADR can be retired once `staging.stg_utilization_segments` reads the attribute, at which point `reset_in_seconds` becomes a candidate for removal. That is cc-otel's call, not this repo's.

## Amendment, 2026-09-22: the countdown rounds up

The decision above does not change; the formula in it does. It shipped as
`floor`, and `floor` is wrong for the reconstruction this ADR's Context names.

`staging.stg_utilization_segments` reconstructs the window end as
`ts + reset_in_seconds`, binned to five minutes, and a rate-limit window resets
**on a five-minute boundary**. Under `floor` the reconstruction lands below that
boundary by the sub-second part of the sample, so it bins one whole bucket early,
on every sample rather than occasionally. Measured on one seat, one real 5h window
whose true reset is `2026-09-22 10:20:00Z`, the plugin and the retiring statusline
wrapper side by side in `raw.metrics`:

| scope | ts | reset_in_seconds | implied instant | binned window_end |
| --- | --- | --- | --- | --- |
| `cc-otel.statusline` | 05:42:44.664 | 16636 | 10:20:00.664 | 10:20:00 |
| `cc-otel.plugin` | 05:46:21.150 | 16418 | 10:19:59.150 | **10:15:00** |

`marts.fact_usage_window` is keyed on `(user_email, window_type, window_end,
segment_no)`, so one real window became two rows for one seat.

`ceil` puts the reconstruction in `(reset, reset + 1s]`, inside the window's own
bucket. `round` does not: it still lands below the boundary whenever the
fractional part is under half a second.

This changes no name, unit or attribute, so the contract in
[ADR-0001](0001-telemetry-contract.md) is unmoved; only the value's rounding is.
It is also what makes that ADR's "values unchanged from the wrapper" true of this
one: 16636 is `ceil` of the wrapper's own 16635.336 s, so `floor` was the
departure, not `ceil`.
The retirement path in Consequences is unaffected, and remains cc-otel's call.
