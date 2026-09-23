#!/usr/bin/env bash
# One on-request round: request the reviewer, then read the request back off
# the host's own record (an empty requested-reviewers list proves nothing, and
# the login requested and the login recorded can differ).
#
#   request-review <pr> <login> [--comment <phrase>]
#
# Two transports, chosen by the profile's `Request:` line, with the brand left
# out of it.
# Default, `Request: None.`: the host's own request-a-reviewer call. With
# `--comment <phrase>`, from `Request: comment <phrase>`: the phrase is posted as
# a PR comment, which is how a reviewer that is a comment-triggered workflow is
# asked for a round. The host has no reviewer to add for that one, so there is
# nothing to read back off a requested-reviewers list; `host_pr_comment` posts
# and verifies, and the verified comment is the read-back.
#
# `requested_at` is the ISO-8601 time of the review_requested event the
# read-back found, or, under the comment transport, the host's own creation time
# for that comment. Phase 7 passes it to `poll-pr --since` so the round counts on
# whatever head it lands on. The host's clock wherever the host keeps one, because
# a local clock running ahead would put `since` in the future and strand the round
# it asked for; a host that records no time for the comment falls back to a wall
# clock read before the post, which is at or before the comment it stands for.
#
# stdout: {pr, login, requested, readback[], requested_at}
# exit: 0 requested and read back · 1 not read back (never-queued after one retry) · 2 usage
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh" || { printf '{"error":"cannot source _lib.sh"}\n'; exit 2; }
usage='usage: request-review <pr> <login> [--comment <phrase>]'
ship_help "$usage" "$@"
[ -n "${1:-}" ] && [ -n "${2:-}" ] || ship_tooling "$usage"
pr=$1; login=$2; shift 2
case $pr in -*) ship_tooling "$usage" ;; esac
case $login in -*) ship_tooling "$usage" ;; esac
phrase=
while [ $# -gt 0 ]; do
  case $1 in
    --comment) [ -n "${2:-}" ] || ship_tooling "$usage"; phrase=$2; shift 2 ;;
    *) ship_tooling "unknown flag: $1" ;;
  esac
done
ship_load_host

# The comment transport. One post, already verified by the adapter, so there is
# no second attempt to make: a phrase that posted twice would draw two rounds.
if [ -n "$phrase" ]; then
  f=$(mktemp) || ship_tooling "cannot write the request comment"
  trap 'rm -f "$f"' EXIT
  printf '%s\n' "$phrase" > "$f"
  # Read before the post, so the fallback can only be earlier than the comment.
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  c=$(host_pr_comment "$pr" "$f") || ship_fail_host "comment transport: the request comment did not post" "$c"
  jq --argjson pr "$pr" --arg l "$login" --arg now "$now" \
    '{pr: $pr, login: $l, requested: true, readback: [.url],
      requested_at: (.created_at // $now)}' <<<"$c"
  exit 0
fi

out=$(host_pr_request_review "$pr" "$login") || ship_tooling "request call failed"
first_at=$(jq -r '.requested_at // empty' <<<"$out")
if [ "$(jq -r .requested <<<"$out")" != true ]; then
  sleep 5
  out=$(host_pr_request_review "$pr" "$login") || ship_tooling "request call failed"
  # Keep the EARLIER stamp. The first POST may have landed with only its
  # read-back delayed, in which case the retry sees its own event in `before`
  # and falls back to a wall clock later than the request that actually
  # queued. Reporting the later one would make --since wait out a round that
  # arrived in between.
  out=$(jq --arg f "$first_at" '.requested_at = (
          [.requested_at, (if $f == "" then empty else $f end)] | min)' <<<"$out")
fi
jq --argjson pr "$pr" --arg l "$login" '{pr: $pr, login: $l} + .' <<<"$out"
[ "$(jq -r .requested <<<"$out")" = true ]
