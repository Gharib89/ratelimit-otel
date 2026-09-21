# ADR-0003: Sample every session, including CI, and fall back for identity

Status: accepted, 2026-09-21; scope amended 2026-09-21 (see Amendment)
Resolves: CONTEXT.md open decision 3 (whether to sample on CI and cloud sessions)

## Context

Sessions on a CI runner or a cloud sandbox carry `terminal_type = non-interactive`. They consume the same account-wide windows as a human seat, so excluding them loses real utilization; including them adds rows that a seat-level view cannot attribute.

The reason to exclude them was that they have no identity. That reason was measured and is narrower than it looked: a `CLAUDE_CODE_OAUTH_TOKEN` run never writes an `oauthAccount` to `~/.claude.json`, but the environment still carries the email in two other places.

## Decision

Sample in every session. Emit with no email rather than not emitting.

Identity is read in this order, first hit wins, the same ladder the wrapper has at `installer/cc-otel-wrapper.mjs:112`:

1. `~/.claude.json`, `oauthAccount.emailAddress` (lowercased) and `oauthAccount.accountUuid`
2. `user.email=` parsed out of `$.env.get("OTEL_RESOURCE_ATTRIBUTES")`
3. `$.env.get("CLAUDE_USER_EMAIL")`

Sampling is a `$.clock.every` timer started at `session.start`, plus a sample at `turn.complete`. `rateLimits` is `[]` at `session.start` and fills only after the first API response, so every send is gated on a non-empty array; a turn is what guarantees a response has landed.

A per-seat floor of **five minutes** sits between deliveries. The wrapper needed one because a statusline repaints constantly. This needs one for a different reason: it runs in every session on every seat, so volume multiplies by sessions per seat rather than being one terminal's.

Samples are neither deduplicated nor smoothed here. Two concurrent sessions on one account reporting the same numbers is correct; collapsing them is the consumer's aggregation, not the producer's.

## Consequences

CI rows arrive with no `user.email` and are attributable only to the account. That is the honest shape: the utilization was real and the seat is unknown.

`staging.stg_utilization_segments` joins the two metrics on `(user_email, usage_window, ts)` with no session key, so two concurrent sessions for one account emitting in the same second fan the join out. That defect is cc-otel's to fix and is not worked around here. `session.id` is emitted on every datapoint's resource so the fix has a key available the day it is written.

## Amendment, 2026-09-21: a cloud sandbox is unreachable

The decision above does not change. Its scope does: of the two non-interactive
environments the Context names, a **cloud sandbox cannot reach the collector at
all**, measured rather than inferred.

Four routine fires from a cloud sandbox, under both the Trusted and the Custom
network setting:

```
host=github.com            status=400 connect_s=0.000523 tls_s=0.192608
host=<the collector>       status=000 connect_s=0.000288 tls_s=0.000000 curl_exit=56
```

github.com completes a TLS handshake and answers. The collector host is reset
before any TLS, every time, and no row from any of the four fires reached
`raw.metrics`. The sandbox egress proxy is allowing hosts and refusing ours
specifically, so the block sits below anything the plugin controls: a hook's
`$.http.fetch` fails exactly where that curl does.

This is not worked around here. There is nothing in the plugin to change: the
refusal is the sandbox's, and a tunnel or a relay would be a second delivery path
to own for an environment whose utilization the account-wide windows already
record from every other seat. A cloud sandbox therefore samples like any other
session and delivers nothing: by the ordinary `no endpoint means no send` path of
[ADR-0004](0004-transport-reads-the-console-env-block.md) where the policy does not
reach it, and by the proxy refusing the connection where it does. Re-test with the
curl above if that allowlist behaviour changes.

A CI runner is untouched by this amendment: it was never measured unreachable, and
the identity ladder above is what it exercises.
