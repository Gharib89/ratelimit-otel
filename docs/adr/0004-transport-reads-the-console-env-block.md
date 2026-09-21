# ADR-0004: The transport reads the console telemetry env block

Status: accepted, 2026-09-21

## Context

The plugin has to reach a collector, and the retiring statusline wrapper reached it
by carrying its own configuration: endpoint, bearer and stamp baked into a
`cc-otel-wrapper.config.json` beside the script (cc-otel ADR-0032). CONTEXT.md
already claims the plugin needs "no local artifact", and nothing had established
what makes that claim true.

The console telemetry env block already fans out the settings Claude Code's own
OTel exporter uses. The open question was whether a hook can read them and whether
a hook can deliver on them, both of which were measured rather than assumed.

Both hold, measured on 2026-09-21 on a loaded probe plugin (`--plugin-dir`,
function hooks enabled, a real session on a fleet seat). The endpoint and the
header pair are readable from inside a hook, by either route:

- `$.env.get("OTEL_EXPORTER_OTLP_ENDPOINT")` returns the endpoint.
- `$.env.get("OTEL_EXPORTER_OTLP_HEADERS")` returns the header pair, name
  `Authorization`.
- `$.settings.read({ source: "policy" })` exposes the same values under `.env`,
  alongside `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_METRICS_EXPORTER` and
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`.

And delivery works, end to end against the live collector:

```
$.http.fetch(endpoint + "/v1/metrics", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: <from env> },
    body: <OTLP JSON, one gauge datapoint> })
-> status 200, body {"partialSuccess":{}}
```

The probe used a deliberately foreign metric name and the collector dropped it: no
row reached `raw.metrics`, which re-confirms cc-otel ADR-0030's foreign-record rule
against a live collector rather than a reading of it.

## Decision

The transport carries no configuration of its own. It reads the endpoint and the
`Authorization` header out of the console telemetry env block at send time, POSTs
**OTLP JSON** to `<endpoint>/v1/metrics`, and **skips the sample when the endpoint
is absent**.

- **No config artifact.** The plugin has no successor to the wrapper's config file
  and no credential of any kind lives in this repo. The values exist only in the
  console policy and only in process memory while a send is in flight. This is what
  makes CONTEXT.md's "no local artifact" true rather than aspirational.
- **OTLP JSON, not protobuf.** The policy block declares `http/protobuf`, which
  governs Claude Code's own exporter and not this plugin. The collector accepts JSON
  on the same `/v1/metrics` path, so the plugin stays dependency-free with no
  protobuf encoder to carry.
- **No endpoint means no send.** Where the console policy does not reach a scope,
  `$.env.get` returns nothing and the sample is skipped, not queued and not
  retried. This does not narrow
  [ADR-0003](0003-sample-every-session-with-an-identity-ladder.md): every session
  still samples, and what a missing endpoint removes is the delivery, not the
  sample or the session it came from.

This repo is public. The mechanism is named here; the endpoint host and the header
value are not, and never are
([coding standards](../contributing/coding-standards.md)).

## Consequences

The plugin inherits the console's routing for free: a seat that already receives
official Claude Code telemetry needs nothing added to send this, and a seat whose
policy moves follows it. The cost is that the plugin cannot be pointed anywhere
by itself, which is deliberate: an endpoint this repo could set is an endpoint this
repo would have to hold.

Skipping on a missing endpoint is the plugin's **second silent no-op**, beside the
missing `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`. A scope without the policy produces no
records and reports nothing, which is correct and is also the second hypothesis for
"nothing happened". It must not be logged as an error on every sample: the
sampler runs in every session on every seat, so a dead endpoint would otherwise be
a repeating error on every seat the policy does not reach.

A collector that stops accepting JSON, or a policy that stops carrying the endpoint
under these names, breaks delivery silently, in the same shape as everything else
here. Both are outside this repo, and both are re-testable with the probe above.
