# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Dimension labels

Three dimensions beside the five triage roles. Triage stamps **at most one label per dimension**, at triage time, alongside the role label, so a maintainer glancing at the tracker reads off what kind of change an issue is, how big it is and how urgent it is without opening it.

Implementation order is **derived** from priority, size and blocking edges, and is never stored as a label: a rank label rots the moment a higher issue ships.

### Kind

What kind of change the issue asks for. Each label names the Conventional Commit type that grades the release, so the label read at triage is the type the PR title carries.

| Label | Type | Color | Description |
| --- | --- | --- | --- |
| `bug` | `fix` | `d73a4a` | Something isn't working |
| `enhancement` | `feat` | `a2eeef` | New feature or request |
| `documentation` | `docs` | `0075ca` | Improvements or additions to documentation |
| `refactor` | `refactor` | `8250df` | Behavior-preserving restructure, no functional change |
| `chore` | `chore` | `fef2c0` | Tooling, deps or housekeeping, no behavior change |

### Size

How much of the codebase the change moves: the effort a maintainer weighs before picking the issue up, not a time estimate.

| Label | Color | Description |
| --- | --- | --- |
| `XS` | `e4e4e7` | Trivial: one spot, minutes |
| `S` | `b4b4bb` | Small: surgical, about one file |
| `M` | `71717a` | Medium: multi-file or new path |
| `L` | `3f3f46` | Large: sweep or new module |
| `XL` | `18181b` | Extra-large: new subsystem, design-gated |

### Priority

How much it costs to leave the issue undone.

| Label | Color | Description |
| --- | --- | --- |
| `critical` | `b60205` | Production-breaking, no workaround |
| `high` | `d93f0b` | Broken functionality or active exposure |
| `med` | `fbca04` | Should do: value but not urgent |
| `low` | `0e8a16` | Nice to have: no urgency |
