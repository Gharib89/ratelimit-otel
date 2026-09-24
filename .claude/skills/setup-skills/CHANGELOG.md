# CHANGELOG

Every entry here is written by the release run on main, which grades the bump
from the squash subject's Conventional-Commit type and cuts one entry per
released version. See
[docs/adr/0003-version-and-changelog-cut-on-merge.md](https://github.com/Gharib89/skills/blob/main/docs/adr/0003-version-and-changelog-cut-on-merge.md).

<!-- version list -->

## v5.3.0 (2026-09-24)

### Features

- **ship**: An attended run in a cloud sandbox prepares it as an unattended run does
  ([#263](https://github.com/Gharib89/skills/pull/263),
  [`2101eae`](https://github.com/Gharib89/skills/commit/2101eae4be28ca49caa65dc32e47dcc817a734c4))


## v5.2.0 (2026-09-23)

### Features

- **ship**: Poll-pr and request-review take the Reviewer by name
  ([#248](https://github.com/Gharib89/skills/pull/248),
  [`ef35ae6`](https://github.com/Gharib89/skills/commit/ef35ae6b5805d05becf0aebc3abbe4857abbcbba))


## v5.1.2 (2026-09-23)

### Documentation

- **ship**: Agent-facing is the one rule, subagents write their own Report files, derived-copy
  pointer rule ([#245](https://github.com/Gharib89/skills/pull/245),
  [`c3b3e89`](https://github.com/Gharib89/skills/commit/c3b3e8907859cc343442f05aad3dc4783f61b722))


## v5.1.1 (2026-09-23)

### Bug Fixes

- **ship**: Drop dated prompt patterns found by a prompt audit
  ([`c4e475e`](https://github.com/Gharib89/skills/commit/c4e475e2d89af2ad7b81d594990ad695460c3522))


## v5.1.0 (2026-09-21)

### Features

- **ship**: The PR body states the door and the blast radius
  ([#237](https://github.com/Gharib89/skills/pull/237),
  [`5f6a870`](https://github.com/Gharib89/skills/commit/5f6a87093c08e94667b719c5a628d9375cdbeed4))


## v5.0.0 (2026-09-21)

### Features

- **ci**: Cut the version bump and per-skill changelog on merge
  ([#224](https://github.com/Gharib89/skills/pull/224),
  [`612baa8`](https://github.com/Gharib89/skills/commit/612baa85c93acbe697872ca324396722afe14ca2))

- **setup-skills**: Create the Kind, Size and Priority dimension labels and write their section
  ([#228](https://github.com/Gharib89/skills/pull/228),
  [`4913e44`](https://github.com/Gharib89/skills/commit/4913e4487191bcdb66140b2bea968bdde6108739))

- **ship**: --full needs --brief, ci-wait reads No-checks legal, run-file takes --issue
  ([#232](https://github.com/Gharib89/skills/pull/232),
  [`6765e04`](https://github.com/Gharib89/skills/commit/6765e047c40cfe4ebae0e0bb438b7d7f115c0e22))

- **ship**: The PR body becomes the reviewer's short form
  ([#226](https://github.com/Gharib89/skills/pull/226),
  [`1fd3013`](https://github.com/Gharib89/skills/commit/1fd30135b2121bafae1f3a669281f0e877139817))

### Breaking Changes

- **ship**: `poll-pr <pr> --full <id>` without `--brief` now exits 2. The invocation that lifted a
  round's clip is `poll-pr <pr> --brief --full <id>`.
