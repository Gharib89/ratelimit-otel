# CHANGELOG

Every entry here is written by the release run on main, which grades the bump
from the squash subject's Conventional-Commit type and cuts one entry per
released version. See
[docs/adr/0003-version-and-changelog-cut-on-merge.md](https://github.com/Gharib89/skills/blob/main/docs/adr/0003-version-and-changelog-cut-on-merge.md).

<!-- version list -->

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
