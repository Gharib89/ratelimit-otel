# ADR-0005: Deliver on movement

Status: accepted, 2026-09-23
Supersedes: ADR-0003's sampling triggers and its five-minute delivery floor, and that ADR's 2026-09-22 amendment's floor waiver

## Context

ADR-0003 sampled on a five-minute `$.clock.every` tick and at `turn.complete`,
behind a per-seat floor in `$.store` that allowed one delivery every five
minutes, waived only at `session.end`. The clock existed because nothing told
the plugin when a window moved, so it asked. Two costs followed: an open, idle
session re-sent the same figure every five minutes, and a move inside the floor
waited for the next tick. Every POST was awaited in its hook.

Claude Code now pushes `session.measure`: "fires when the engine measures the
session and a unit moved: after each main-thread turn, and when a rate-limit
window moves a whole point". Its `rateLimits` are the ones `$.session.usage()`
answers.

## Decision

**A sample is delivered only on movement.** A window has moved when its
whole-point `percentUsed` (the integer part) or its `resetsAt` differs from the
last delivery that landed for this session, or when it is newly present. The
first reading of a session therefore always delivers. The comparison is per
session and in memory, keyed by `$.session.id()`, and advances only when a
POST answers `ok`: a refused, rejected or unanswered POST leaves the movement
pending for the next trigger. Only the emitted kinds (`five_hour`, `seven_day`)
are compared, so a `spend_limit` move is no movement.

**Two triggers, one gate.** `session.measure` replaces `turn.complete` and the
clock, and `session.end` stays. Neither waives the gate, and `e.changed` is not
read: the gate decides. `session.start` keeps only its debug line.

**Await only at exit.** On `session.measure` the POST is started and the hook
returns `next(e)` at once; the gate advances in the detached work. On
`session.end` the POST is awaited, because a detached one there is lost. With
the uniform gate, `session.end` POSTs only when a movement never landed,
including one still in flight at exit. There is no in-flight guard: two POSTs
of one movement can both land, which the consumer's max aggregation absorbs.

Unchanged: the non-empty `rateLimits` gate, `spend_limit` skipped, the identity
ladder, the account attributes once per session (now: while nothing has landed
for this session), the silent failure modes (ADR-0004) and the payload
(ADR-0001).

## Measured basis

Claude Code 2.1.280, 2026-09-23, each through a throwaway probe plugin logging
via `--debug-file`, against a local delayed sink and never prod:

- `session.measure` fires under `-p` and interactively, once after the first
  main-thread response, then after each main-thread turn where a unit moved.
  `cost` moves every turn, so in practice it fires every turn. It never fired
  at or after `session.end`.
- It fires mid-turn on a whole-point move. In one main-thread turn of 10+
  steps, 5h moved 7 to 8 and 8 to 9; `session.measure` fired at the end of each
  of those steps, 313 ms and 19 ms before the next began, while a 10 s tick saw
  the moves 5.3 s and 7.6 s later.
- An awaited POST in `session.measure` still running when the next prompt goes
  out holds that turn's API request for exactly 3.0 s. Detached, the next turn
  starts in 15 to 19 ms, and `$` works inside the fetch callback after the hook
  has returned.
- `session.end` shares a 1.5 s bound across all plugins. The awaited prod POST
  there took a median of 306 ms and a max of 1040 ms.
- **A move carried by a subagent's response fires it.** One `-p` turn in which
  the main thread spawned a single subagent: the subagent's first response
  (the request carrying `cc_is_subagent=true`) moved 5h from 3 to 4, and
  `session.measure` fired with `changed=rateLimits|cost` at that instant, 22 s
  before the main thread's next response:

```
11:25:04.822 PROBE measure changed=context|rateLimits|cost rl=five_hour=3,seven_day=2
11:25:04.822 PROBE step agent=main idx=0 rl=five_hour=3,seven_day=2
11:25:06.066 [Stall] tool_dispatch_start tool=Agent
11:25:06.133 attribution header ... cc_is_subagent=true
11:25:08.664 PROBE tick rl=five_hour=3,seven_day=2
11:25:10.819 PROBE measure changed=rateLimits|cost rl=five_hour=4,seven_day=2
11:25:10.819 session.measure settled in 1.7ms
11:25:10.819 PROBE step agent=a330476caf0a808e4 idx=0 rl=five_hour=4,seven_day=2
11:25:28.525 [Stall] tool_dispatch_end tool=Agent outcome=ok durationMs=22459
11:25:32.841 PROBE step agent=main idx=1 rl=five_hour=4,seven_day=2
11:25:32.849 PROBE measure changed=context|cost rl=five_hour=4,seven_day=2
```

  That is why no clock remains: the one job left for one was a move carried by
  a subagent while the main thread waits on it, and the push already covers it.

## Alternatives rejected

- **A clock beside the push** (a one-minute tick for long subagent calls):
  rejected by the subagent measurement above.
- **Keeping the floor:** no latency gain, and it holds back the movement this
  ADR exists to deliver.
- **A per-seat gate in `$.store`:** brings back the lost-update race between
  concurrent sessions and the store itself, for a comparison that is per
  session anyway.
- **Awaiting everywhere:** the 3 s hold on the next turn.

## Consequences

Volume is bounded by movement rather than by a clock: per session, one first
reading plus one delivery per whole point moved or window rolled over. An idle
session sends nothing. ADR-0003's 2026-09-22 amendment rejected a
movement-gated waiver because a `claude -p` loop moves the figure on every
invocation; under this gate such a loop still delivers each invocation's first
reading, which is the honest reading, and no longer re-sends between moves.

Deduplicating across concurrent sessions stays the consumer's job (ADR-0003).
