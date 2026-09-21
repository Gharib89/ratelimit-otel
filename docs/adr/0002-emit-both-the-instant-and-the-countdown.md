# ADR-0002: Emit both the reset instant and the countdown

Status: accepted, 2026-09-21
Resolves: CONTEXT.md open decision 2 (`resetsAt` versus `reset_in_seconds`)
Refines: [ADR-0001](0001-telemetry-contract.md)

## Context

`$.session.usage()` hands back `resetsAt` as an ISO-8601 instant. The wrapper never had it: it emitted `claude_code.usage.reset_in_seconds`, a countdown, and `staging.stg_utilization_segments` reconstructs the window end from that countdown plus the record's timestamp, binned to five minutes.

The open question was whether to replace the countdown with the instant. Replacing it outright is a downstream schema change, and the reconstruction is what every existing row was built from.

## Decision

Emit both, in different positions:

- `claude_code.usage.reset_in_seconds` stays a metric, computed as `floor((Date.parse(resetsAt) - now) / 1000)`. Every existing row and view keeps its meaning.
- `resets_at` is added as a **datapoint attribute** on both metrics, the ISO string verbatim from `$.session.usage()`.

The attribute is additive: a consumer that ignores it is unaffected, and the staging view can stop reconstructing the window end whenever its owner chooses to, without this repo shipping anything on that day.

## Consequences

The instant is carried twice, once exactly and once as a derived countdown that loses precision to the five-minute bin. That redundancy is deliberate and temporary: it is what lets the producer change before the consumer.

It also makes the window's identity explicit on the wire. A window is identified by `resets_at`, so a rollover is visible as a new value rather than inferred from a countdown that jumped, which is the failure the countdown alone could not distinguish from a drop to zero.

This ADR can be retired once `staging.stg_utilization_segments` reads the attribute, at which point `reset_in_seconds` becomes a candidate for removal. That is cc-otel's call, not this repo's.
