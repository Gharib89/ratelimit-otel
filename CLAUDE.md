# ratelimit-otel

## Agent skills

### Issue tracker

Issues live as GitHub issues in `Gharib89/ratelimit-otel`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Ship

`/ship` drives one issue to a merge-ready PR. This repo's ship profile: `docs/agents/ship.md`. Without that file ship refuses: run `/setup-skills`.

Every skill under `.claude/skills/` is a derived copy, changed at its source and refreshed here; `skills-lock.json` records each one's source. `ship`, `cloud-ship` and `setup-skills` come from `Gharib89/skills`; the skills ship composes come from `mattpocock/skills`, `upstash/context7` and `humanlayer/skills`. Refresh a skill by re-running its install line at project scope, without `-g`. Ship's refresh chains its preflight, so a profile the refreshed ship no longer reads is reported now, not on the next `/ship`: `npx skills add Gharib89/skills --skill ship --skill cloud-ship --skill setup-skills --agent claude-code -y && .claude/skills/ship/scripts/preflight.sh none`.
