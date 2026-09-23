# ADR-0006: Distribute to the fleet as a pinned release archive

Status: accepted, 2026-09-23

## Context

A `github` marketplace source is cloned with git on every seat. That puts git, and on
some seats SSH, on the install path: on 2026-09-23 a seat's fresh marketplace clone went
over SSH and failed with `Host key verification failed`, because the seat had no
`~/.ssh/known_hosts`. The route CONTEXT.md named until now, this repo's
`.claude-plugin/marketplace.json` pinned by the console by `ref` or `sha`, carries that
dependency to all 149 seats.

Claude Code v2.1.224 added a plugin source of `"archive"`: a zip over HTTPS, with an
optional `sha256` that refuses the install on a mismatch. The org console can declare a
marketplace inline, with a source of `"settings"`, so a seat fetches one HTTPS file and
nothing else.

## Decision

The fleet installs a **release archive**: the zip of `plugin/` attached to the GitHub
Release for a tag, with `.claude-plugin/plugin.json` at its root, named
`ratelimit-otel-<version>.zip` from the manifest version and published with its
`sha256`. The console entry names one archive by its versioned URL and pin:

```
https://github.com/Gharib89/ratelimit-otel/releases/download/ratelimit-otel--v<version>/ratelimit-otel-<version>.zip
```

The tag in that path is `ratelimit-otel--v<version>` (`tagFormat`), not `v<version>`.

- **Pinned, not floating.** A new version reaches the fleet only when the operator
  edits the console entry's URL and `sha256`. A `releases/latest` URL would let seats
  update on their own, but it gives up both the staged rollout (one seat, then the fleet
  after a quiet period) and the only integrity check a download gets.
- **`autoUpdate: true` stays on the entry.** With a pinned URL it finds nothing new on
  most passes. Its job is to make a seat act on an edited entry.
- **No `version` on the console's plugin entry.** plugin.json's version wins at
  install, so a second copy could only drift. The manifest version stays the only copy,
  the same rule the marketplace entry follows.
- **`.claude-plugin/marketplace.json` stays**, as the route a developer seat installs
  by, still validated by the local gate. The fleet never reads it.

## Consequences

- **A version floor, accepted as a coverage gap.** A seat below 2.1.224 fails to load the
  marketplace. A seat below the plugin's own floor loads it and emits nothing, the
  **silent no-op**. The plugin's own floor is not known: 2.1.278 is the oldest version it
  was verified on (ADR-0003). Measured on 2026-09-23 over the last 14 days, 6 of 149 active
  seats were below 2.1.224 and 60 were below 2.1.278. The rollout does not wait for them.
  An uncovered seat sends no plugin rows, so the gap can be measured, and the one-seat
  probe finds the real floor.
- **Every release is a console edit.** The operator copies the URL and `sha256` from the
  release, so the asset name and the digest's publication are public surface.
