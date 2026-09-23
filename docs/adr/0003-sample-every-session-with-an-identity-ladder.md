# ADR-0003: Sample every session, including CI, and fall back for identity

Status: accepted, 2026-09-21; amended 2026-09-21 and 2026-09-22 (see the Amendments)
Resolves: CONTEXT.md open decision 3 (whether to sample on CI and cloud sessions)
Superseded in part: its sampling triggers and delivery floor, and the 2026-09-22 amendment's floor waiver, by [ADR-0005](0005-deliver-on-movement.md). Sampling every session and the identity ladder stand.

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

## Amendment, 2026-09-22: a session ending is sampled, and is where the floor is waived

The decision above stands and gains a third trigger. `$.clock.every` dies with the
process and `turn.complete` does not fire on the way out, so the last state of a
session was whatever the previous sample happened to catch.

A gap is not a lost total: the metrics are gauges of a window's utilization, so
the next sample reports the true current figure whatever happened in between. The
loss is real in one case only, and then it is permanent: where the seat emits
nothing more before the window resets, no sample ever observes that window's final
state, and `end_pct` and `peak_pct` in cc-otel's `marts.fact_usage_window` stay
understated for good. Measured on one seat's 5h series over 7 days, 235 intervals,
a five-minute tail is worth about 4 points at p90 and about 65 at the maximum
observed; the 7d window barely notices.

`on("session.end", ...)` therefore takes a sample, reusing the same sampler, and it
is **the one place the five-minute delivery floor is waived**. The floor bounds
volume that multiplies by sessions times samples; a session end adds exactly one
delivery per session, a term that does not compound, and holding it would skip
precisely the tail shorter than five minutes that this amendment exists for. The
middle option, waiving only where `percentUsed` moved since the last delivery, was
rejected on the same arithmetic: a `claude -p` loop consumes window budget, so the
figure moves on every invocation, and the only sessions it would quiet are those
with no API response at all, which the non-empty `rateLimits` gate already drops.

Which exits reach the hook was measured, not assumed, on Claude Code 2.1.278: a
copy of the plugin under its own name logging `e.reason` through `--debug-file`,
interactive paths driven through a pty. The table is the paths that were driven,
not the whole of `ExitReason`: `resume` and `logout` are in the enum and were not
driven, so nothing here claims them either way.

| Exit path | fires | `reason` |
|---|---|---|
| `claude -p` run done | yes | `other` |
| ctrl-C twice at the prompt | yes | `prompt_input_exit` |
| ctrl-D | yes | `prompt_input_exit` |
| SIGINT to the process group | yes | `other` |
| SIGHUP, the terminal closed outright | yes | `other` |
| `/clear` | yes | `clear` |
| SIGKILL | **no** | - |

### Consequences

`$.session.id()` still answers the ending session's id on every path above,
including `/clear`, so the sample is attributed to the session it belongs to and
nothing is threaded through from the event.

A `/clear` is a session end, measured, so a seat that clears often delivers on each
clear rather than once per terminal session. That is bounded by human speed and it
is the same honest reading as any other: the cleared session's windows were real.
`resume` and `logout` are the two undriven reasons; if they fire the hook they read
the same way, and nothing downstream distinguishes them.

Every session exit now carries one POST, bounded by the engine's 1.5 s
`session.end` budget. Measured against the real collector the hook settled in
335 ms, so the delivery completes rather than being cut off at exit.

`kill -9` raises nothing and leaves the tail open. There is nothing in the plugin
to change: the process is gone before any hook is bound.
