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

Every skill under `.claude/skills/` is a derived copy, changed at its source and refreshed here; `skills-lock.json` records each one's source. `ship`, `cloud-ship`, `setup-skills` and `update-skills` come from `Gharib89/skills`; the skills ship and setup-skills compose come from `mattpocock/skills`, `upstash/context7` and `humanlayer/skills`, each at the pin of the skill that composes it. `/update-skills` refreshes them all in one PR. By hand, refresh a skill by re-running its install line at project scope, without `-g`. Ship's refresh chains its preflight, so a profile the refreshed ship no longer reads is reported now, not on the next `/ship`: `npx skills add Gharib89/skills --skill ship --skill cloud-ship --skill setup-skills --skill update-skills --agent claude-code -y && .claude/skills/ship/scripts/preflight.sh none`.

## Verifying a delivery landed

A green `$.http.fetch` is not proof of a row: the collector attests every record and
drops foreign ones (cc-otel ADR-0030), so the only proof that an emit change worked
is a row in cc-otel's `raw.metrics`. This is the check the issue-level "real rows"
criterion means.

**The connection.** `.env` at this repo's root carries `DATABASE_URL` and is
gitignored, because this repo is public. It is a copy; `~/wip/projects/cc-otel/.env.prod`
stays the source of truth, so a rotated credential is re-copied from there rather than
edited here. Do **not** source either file with `.` or `source`: cc-otel's has CRLF
endings, and the shell then tries to execute a line and echoes a password into the
transcript. Parse the line instead.

**Reachability is measured, never assumed.** The prod server has no open-internet
firewall rule and the ITWorx Fortinet VPN is full-tunnel, dropping outbound 5432, so
*on* the VPN the server is unreachable even from an allow-listed range (cc-otel
CLAUDE.md, "Prod DB access"). Probe before concluding anything about the data:

```sh
timeout 15 bash -c 'cat < /dev/null > /dev/tcp/ccotel-pg-prod.postgres.database.azure.com/5432' \
  && echo open || echo "blocked: on the VPN, or the pinhole is closed"
```

Blocked: reach prod through Azure Cloud Shell, or go off-VPN and use cc-otel's
`open-my-ip.ps1` pinhole.

**The query.** There is no Postgres client in this repo; run it from the cc-otel
checkout, which has `psycopg` (there is no `psql` on this machine):

```sh
cd ~/wip/projects/cc-otel && uv run python - <<'PY'
import psycopg
url = next(l.split("=", 1)[1].strip() for l in
           open("/home/ribo/wip/projects/ratelimit-otel/.env") if l.startswith("DATABASE_URL="))
with psycopg.connect(url, connect_timeout=25) as c, c.cursor() as cur:
    cur.execute("""
      select metric_name, usage_window, metric_type, value_kind, count(*), max(ts)
      from raw.metrics where scope_name = 'cc-otel.plugin'
      group by 1, 2, 3, 4 order by 1, 2
    """)
    for r in cur.fetchall(): print(r)
PY
```

`metric_type` and `value_kind` are in the select because the ship profile's OTLP verification
asserts them: ADR-0001 contracts both metrics as gauges, and a consumer downstream filters on
`value_kind = 'gauge_last'`.

`scope_name = 'cc-otel.plugin'` is what separates this plugin's rows from the retiring
wrapper's ~35,000 rows under the same two metric names. Keep every query read-only:
this is the production database, and nothing in this repo writes to it.
