#!/usr/bin/env bash
# Local gate: every check this repo runs before a PR opens. No workflow judges
# a PR, so every gate below runs here and nothing defers.
# Written by setup-skills; owned by the repo, which is who edits it from here.
#
#   scripts/local-gate.sh [--small <node>] [--base <ref>]
#
# Contract (ship's local-gate contract, the same in every repo):
#   stdout: one JSON object, {"verdict","base","lane","gates":{<name>:<status>}}
#   stderr: a failing gate's last 40 log lines
#   exit:   0 every gate passed · 1 a gate failed · 2 tooling
#   gate status: pass | fail | deferred-to-ci | unavailable
#     deferred-to-ci: planned, CI proves this gate (unused here: no CI legs)
#     unavailable:    unexpected, the gate could not ask its question (tool missing)
#   verdict: pass | fail | unavailable; fail wins over unavailable
#   `secrets` is required in every lane. Base defaults to origin/HEAD.
set -uo pipefail

small="" base=""
while [ $# -gt 0 ]; do
  case $1 in
    --small) [ $# -ge 2 ] || { printf '{"error":"--small needs a test node"}\n'; exit 2; }; small=$2; shift 2 ;;
    --base)  [ $# -ge 2 ] || { printf '{"error":"--base needs a ref"}\n'; exit 2; }; base=$2; shift 2 ;;
    *) printf '{"error":"unknown flag: %s"}\n' "$1"; exit 2 ;;
  esac
done
[ "${BASH_VERSINFO[0]}" -ge 4 ] || { echo '{"error":"bash 4+ required (associative arrays); macOS: brew install bash"}'; exit 2; }
command -v jq >/dev/null || { echo '{"error":"jq not installed"}'; exit 2; }
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo '{"error":"not inside a git checkout"}'; exit 2; }
if [ -z "$base" ]; then
  base=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null) \
    || { echo '{"error":"cannot resolve origin/HEAD; run git remote set-head origin -a or pass --base"}'; exit 2; }
  base=${base#refs/remotes/}
fi
lane=full; [ -z "$small" ] || lane=small

declare -A gates
log=$(mktemp); trap 'rm -f "$log"' EXIT
run()  { local name=$1; shift; if "$@" >"$log" 2>&1; then gates[$name]=pass; else gates[$name]=fail; tail -n 40 "$log" >&2; fi; }
mark() { gates[$1]=$2; }   # mark <name> deferred-to-ci|unavailable

# The `release` gate's body, beside the other helpers so the gates below stay a
# uniform list of `run` lines. The writer resolves the manifest relative to its
# own cwd, so the probe is a throwaway tree with the manifest at that same path.
manifest="plugin/.claude-plugin/plugin.json"
marketplace=".claude-plugin/marketplace.json"
writer="scripts/set-manifest-version.mjs"
probe_version=9.9.9
manifest_writer_writes() {
  local root=$PWD d rc
  d=$(mktemp -d) || return 1
  mkdir -p "$d/${manifest%/*}"
  cp "$root/$manifest" "$d/$manifest" || { rm -rf "$d"; return 1; }
  ( cd "$d" && node "$root/$writer" "$probe_version" \
      && [ "$(jq -r .version "$manifest")" = "$probe_version" ] )
  rc=$?
  rm -rf "$d"
  return $rc
}

# The small lane carries two classes of node, per the profile's `Small node:`.
# A directory is a test node; anything else is the path of a changed document,
# which no test runner can take. `docs` is the class, resolved once here so each
# gate below reads it rather than re-deriving it.
class=code
if [ "$lane" = small ] && [ ! -d "$small" ]; then
  [ -e "$small" ] || { printf '{"error":"--small %s is neither a test directory nor an existing file"}\n' "$small"; exit 2; }
  class=docs
fi

# --- gates ---------------------------------------------------------------------

# secrets: required in every lane and every class.
if command -v gitleaks >/dev/null; then
  run secrets gitleaks detect --no-banner --redact --log-opts="$base..HEAD"
else
  mark secrets unavailable
fi

# A documentation change compiles nothing and runs no hook, so the code gates
# below would each answer a question the change did not ask. They are omitted
# rather than reported as passes nothing earned.
if [ "$class" = code ]; then

  # deps: a fresh worktree has no node_modules, and typecheck reads them.
  if [ -f package-lock.json ]; then
    run deps npm ci --no-audit --no-fund
  else
    mark deps unavailable
  fi

  # typecheck: reads .claude/types/*.d.ts, which the worktree Bootstrap regenerates.
  if [ -f tsconfig.json ] && [ -d .claude/types ]; then
    run typecheck npx --no-install tsc --noEmit
  else
    mark typecheck unavailable
  fi

  # validate: reads the plugin the way the engine will and refuses what it would.
  # Its capability list is the review surface, so a refusal here never reaches a PR.
  if [ -f plugin/.claude-plugin/plugin.json ]; then
    run validate claude plugin validate plugin --strict
  else
    mark validate unavailable
  fi

  # tests: `claude plugin test <dir>` loads the plugin from <dir> as well as
  # scanning it, so the only node it takes is the plugin root, `plugin`. A
  # code-class small node therefore runs this gate exactly as the full lane does.
  # The presence check is scoped to that same tree on purpose: counting a test
  # this invocation never scans would let the gate go green while skipping it.
  if [ -z "$(git ls-files 'plugin/*.test.ts' 'plugin/*.test.tsx')" ]; then
    mark tests unavailable
  elif [ "$lane" = small ]; then
    run tests claude plugin test "$small"
  else
    run tests claude plugin test plugin
  fi

  # release: scripts/set-manifest-version.mjs runs only inside a release, so no
  # other gate here would ever execute it, and the way it fails is by writing
  # nothing at all. manifest_writer_writes drives it against a throwaway copy of
  # the manifest and reads the version back, so a writer that has stopped
  # writing is caught on the PR rather than on the release that needed it.
  if [ -f "$writer" ] && [ -f "$manifest" ]; then
    run release manifest_writer_writes
  else
    mark release unavailable
  fi

  # marketplace: the root manifest is engine-read public surface (docs/agents/ship.md,
  # ## Public surface) and the `validate` gate above is scoped to the plugin root, so
  # nothing else asks it. --strict is what fails a missing marketplace description,
  # which plain validate reports as a warning and passes.
  if [ -f "$marketplace" ]; then
    run marketplace claude plugin validate . --strict
  else
    mark marketplace unavailable
  fi

  # tag: `claude plugin tag` is the release's agreement gate, run from
  # .releaserc.json's prepareCmd with these same flags. It refuses when the
  # manifest version and the enclosing marketplace entry disagree, so without
  # this gate that drift fails the release on `main` rather than the PR that
  # introduced it. --dry-run creates no tag; --force skips the dirty-tree and
  # tag-exists checks only, which the release needs mid-prepare and which would
  # otherwise make this gate answer about the worktree instead of the manifests.
  if [ -f "$manifest" ] && [ -f "$marketplace" ]; then
    run tag claude plugin tag plugin --dry-run --force
  else
    mark tag unavailable
  fi

fi
# --- end gates -----------------------------------------------------------------

verdict=pass
for s in "${gates[@]}"; do
  case $s in
    fail) verdict=fail ;;
    unavailable) [ "$verdict" = fail ] || verdict=unavailable ;;
  esac
done
case $verdict in pass) rc=0 ;; fail) rc=1 ;; *) rc=2 ;; esac

for k in "${!gates[@]}"; do printf '%s\t%s\n' "$k" "${gates[$k]}"; done \
  | jq -Rs --arg v "$verdict" --arg b "$base" --arg l "$lane" \
      '{verdict: $v, base: $b, lane: $l,
        gates: (split("\n") | map(select(. != "") | split("\t") | {(.[0]): .[1]}) | add // {})}'
exit $rc
