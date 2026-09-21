#!/usr/bin/env bash
# ship phases 7 and 8: one bounded, foreground poll of a PR's head, checks,
# reviews and threads, then ONE JSON summary.
#
#   poll-pr <pr> [--brief, or --brief --full <id>[,<id>]] [--await-review <login>]
#           [--since <iso>] [--await-run <workflow-file>]
#           [--timeout <s>] [--interval <s>]
#
# done when the PR is in conflict (merge-ref checks stay unstarted, so waiting is
# pointless), or every check on the head has completed and, with --await-review,
# a SUBSTANTIVE review by that login has landed. `substantive` is the landing
# signal, set by the host adapter's reviews projection: an empty row and a
# notice-only row are rows, not rounds.
#
# Two landing rules, chosen by the reviewer's profile `Trigger:`; `landed_by`
# names the one that matched.
#   head (default, on-push): the review sits on the current head. Every push
#     earns a new review, so a review on an older commit does not count.
#   since (--since, on-request and auto-once): the review was submitted at or
#     after <iso>, on ANY head. Such a reviewer delivers one round per request
#     and posts it once, so a push between the request and the review leaves
#     the round keyed to the older head, where the head rule would wait out the
#     whole window. Pass `request-review`'s `requested_at` or `open-pr`'s
#     `created_at`. Matching by time rather than by requesting login is
#     deliberate: the login a request is made under and the login the host
#     records can differ. A row with a null submitted_at is host state rather
#     than a timed event (an Azure DevOps vote, which the API leaves
#     unstamped): it cannot answer a question about time, so it satisfies the
#     head rule only.
#     Counting it here would land round 2 instantly off round 1's stale vote.
#
# Each review row carries the round's own `body` and the `id` the host knows it
# by, clipped past 2000 characters and marked "...[truncated]" there: phase 7
# triages from the body, and a round whose findings are in it rather than in
# threads is invisible without it. `--brief --full` names the ids to return whole;
# every other row stays clipped, and an id matching no row changes nothing.
# `threads[]` rows carry the thread's first comment, which `reply-thread` answers,
# and `replied`, true once this identity has answered in that thread.
#
# `--await-run <workflow-file>` settles the workflow run a comment-transport
# reviewer's round comes from before the window may report that reviewer silent.
# Such a run is attached to the default branch's SHA, so `checks` cannot see it,
# and the one signal left was the absence of a review. With the flag the window
# is the RUN's lifetime and `--timeout` only its floor: a run that has not
# finished keeps the poll going, and the ceiling the usage line states is the
# bound on what the run may add, so a `--timeout` past it is the caller's own
# window, which the run then extends by nothing. A run that concluded successfully buys one more
# interval for the row to appear; one that concluded any other way closes the
# window there and then, whatever `--timeout` had left, carrying its URL, which
# the review loop reads as `infra-error` rather than `silent`, or, where the
# conclusion is `skipped`, as the workflow declining the comment. A run still live when the ceiling closes
# is reported as it stands, status and URL, and reads as `infra-error` too: a
# run that outlived the ceiling delivered nothing either. The run is reported on
# `reviewer_run`: null where the flag was not given, `{status, conclusion, url}`
# otherwise, with status `none` and the other two null where no run was created
# at all, and the string
# "unavailable" where the host could not answer the read, the way `threads`
# reports one it could not read. An unavailable read leaves the window at the
# constant and that reviewer's exit is `unreachable` rather than `silent`,
# because a read that did not happen is no evidence about the reviewer. It needs
# `--await-review` (whose reviewer it belongs to) and `--since` (the request the
# run should follow). Which event starts such a run is the
# host's word and the adapter's business: this mechanic names the workflow file
# and the instant, and nothing else.
#
# `reviewer_blocked` non-null with done=false means the round is WAITING (a
# quota or rate-limit notice), not missing. It is read from the awaited login's
# review bodies as well as its PR comments: a reviewer states a notice on either
# surface, and both are read. `threads` is "unavailable" when thread
# state could not be read (GraphQL refused): that reviewer's exit is degraded
# unreachable, the run proceeds.
#
# `--brief` projects that same JSON, from the same single fetch, down to what a
# review loop acts on: head, mergeable, `landed_by`, one row per reviewer round
# (id, submitted_at, substantive, and the body cut to its finding items) and one
# row per OPEN thread (id, path, lead, resolved, replied). `--full` names the
# rows that come back whole, so `--brief --full <id>` is the summary with that
# one round verbatim. Rounds come from `all[]` under the
# --since rule and `on_head[]` under the head rule, the list that rule lands
# from, and the run's own rows drop out: a thread reply of ours posts as a review
# row of its own, and a convergence test that counts it reads its own voice as
# the reviewer's. That drop needs the host identity, so `--brief` asks for it up
# front and exits 2 when the host cannot answer, rather than returning a list it
# cannot promise is the reviewer's alone. The full shape stays the default.
#
# stdout: {head_sha, mergeable, checks[], reviews: {on_head[], all[], total},
#          threads, reviewer_blocked, reviewer_run, landed_by, done, waited_s}
#   --brief: {head_sha, mergeable, landed_by, reviewer_run, rounds[], threads}
# exit: 0 done · 1 window closed first (done=false; re-run to extend) · 2 tooling
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh" || { printf '{"error":"cannot source _lib.sh"}\n'; exit 2; }
# The hard bound on waiting a run out, written once: the usage line is where a
# run reads it.
ceiling=1800
usage="usage: poll-pr <pr> [--brief, or --brief --full <id>[,<id>] to read those rounds whole] [--await-review <login>] [--since <iso>] [--await-run <workflow-file>, whose run holds the window open past --timeout, to ${ceiling}s] [--timeout <s>] [--interval <s>]"
ship_help "$usage" "$@"
[ -n "${1:-}" ] || ship_tooling "$usage"
pr=$1; shift
# A flag in the positional slot is a malformed invocation, not a PR id: without
# this, `poll-pr --brief` reads "--brief" as the id and asks the host for it.
case $pr in -*) ship_tooling "$usage" ;; esac
timeout=480; interval=20; await=""; since=""; await_run=""; full='[]'; brief=false; after_run=0
while [ $# -gt 0 ]; do
  case $1 in
    --brief) brief=true; shift ;;
    --await-review) [ -n "${2:-}" ] || ship_tooling "$usage"; await=$2; shift 2 ;;
    --since) [ -n "${2:-}" ] || ship_tooling "$usage"; since=$2; shift 2 ;;
    --await-run) [ -n "${2:-}" ] || ship_tooling "$usage"; await_run=$2; shift 2 ;;
    # Ids stay strings: GitHub numbers a review and Azure DevOps numbers a
    # thread, and the adapters compare `.id | tostring` against this list.
    --full)
      [ -n "${2:-}" ] || ship_tooling "$usage"
      full=$(ship_id_list "$2") || ship_tooling "$usage"
      shift 2 ;;
    --timeout) [ -n "${2:-}" ] || ship_tooling "$usage"; timeout=$2; shift 2 ;;
    --interval) [ -n "${2:-}" ] || ship_tooling "$usage"; interval=$2; shift 2 ;;
    *) ship_tooling "unknown flag: $1" ;;
  esac
done
# `--full` is a --brief modifier and nothing else. It lifted the adapter's clip
# in the full shape too, but that shape keeps its rounds under `reviews` and has
# no `rounds[]` to read the lifted body off: /ship 205 asked three times and got
# null each time, with no error to say the pair was wrong (#218).
[ "$full" = '[]' ] || $brief || ship_tooling "--full needs --brief; $usage"
[ -z "$since" ] || [ -n "$await" ] || ship_tooling "--since needs --await-review"
[ -z "$await_run" ] || { [ -n "$await" ] && [ -n "$since" ]; } \
  || ship_tooling "--await-run needs --await-review and --since"
# --since is compared as a string against submitted_at, which every adapter
# emits as UTC "YYYY-MM-DDTHH:MM:SSZ". Accept only what normalises to that, so
# an offset this cannot convert (+05:00) is refused outright rather than
# silently sorting wrong. Every mechanic that reports a timestamp
# (request-review's requested_at, open-pr's created_at) already emits it.
if [ -n "$since" ]; then
  case $since in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) ;;
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].*Z|\
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*+00:00)
      since=$(printf '%s' "$since" | sed 's/\.[0-9]*//; s/+00:00$/Z/') ;;
    *) ship_tooling "--since must be UTC ISO-8601 (YYYY-MM-DDTHH:MM:SSZ), got: $since" ;;
  esac
fi
ship_load_host

# --brief promises the run's own rows are gone, and only the identity can tell
# them apart. Asked before the loop, so an unauthenticated host answers now
# rather than after the timeout; the full shape needs no identity and runs on.
me=""
if $brief; then
  me=$(host_identity) || ship_tooling "cannot read the host identity; --brief cannot drop the run's own rows"
fi

norm() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/\[bot\]$//'; }
start=$SECONDS
while :; do
  prj=$(host_pr_get "$pr") || ship_tooling "cannot read PR $pr"
  sha=$(jq -r .head_sha <<<"$prj"); mergeable=$(jq -r .mergeable <<<"$prj")
  checks=$(host_pr_checks "$pr" "$sha") || ship_tooling "cannot read checks"
  reviews=$(host_pr_reviews "$pr" "$sha" "$full") || ship_tooling "cannot read reviews"
  threads=$(host_pr_threads "$pr") || threads='"unavailable"'
  blocked=null
  [ -z "$await" ] || blocked=$(host_pr_reviewer_blocked "$pr" "$await") || blocked=null
  # A read the host refused, an outage included, is "unavailable" rather than a
  # missing run: both leave the window at the constant, and only one of them is
  # evidence about the reviewer. A read that answered with something the filter
  # cannot walk is the same kind of nothing, and saying so keeps the emit below
  # holding one JSON object rather than a `--argjson` that will not parse.
  reviewer_run=null
  if [ -n "$await_run" ]; then
    if runs=$(host_workflow_runs "$await_run" "$since"); then
      reviewer_run=$(jq -c --arg t "$(jq -r .title <<<"$prj")" "$SHIP_REVIEWER_RUN" <<<"$runs") \
        || reviewer_run='"unavailable"'
    else
      reviewer_run='"unavailable"'
    fi
  fi

  pending=$(jq '[.[] | select(.status == "pending")] | length' <<<"$checks")
  landed=true; landed_by=null
  if [ -n "$await" ]; then
    # Both sides are now fixed-width UTC, where a string compare is a
    # chronological one.
    landed_by=$(jq -c --arg l "$(norm "$await")" --arg s "$since" "$SHIP_LANDED_BY" <<<"$reviews")
    [ "$landed_by" != null ] || landed=false
  fi
  done=false
  if [ "$mergeable" = conflict ]; then done=true
  elif [ "$pending" -eq 0 ] && [ "$landed" = true ]; then done=true
  fi
  waited=$((SECONDS - start))
  run_status=$(jq -r 'if type == "object" then .status else "" end' <<<"$reviewer_run")
  # A run that ended any way but successfully ends the window with it, wherever
  # `--timeout` stands: no round is coming out of it, and the minutes left on the
  # clock would be spent waiting for one.
  dead_run=false
  if [ "$landed" = false ] && [ "$run_status" = completed ] \
     && [ "$(jq -r '.conclusion // ""' <<<"$reviewer_run")" != success ]; then dead_run=true; fi
  # The run outranks the constant: a round still being written is not a silent
  # reviewer, and the ceiling is what keeps that from being unbounded.
  if ! $done && ! $dead_run && [ "$landed" = false ] && [ "$waited" -ge "$timeout" ] && [ "$waited" -lt "$ceiling" ]; then
    case $run_status in
      # No run to wait on: no flag, a read the host refused, or no run created.
      ''|none) ;;
      # Only a successful run reaches here, a failed one having closed the
      # window above. It buys one more interval for the row to appear, and one
      # only: waiting on a run that is over is waiting on nothing.
      completed)
        if [ "$after_run" -lt 1 ]; then after_run=1; sleep "$interval"; continue; fi ;;
      # Every other status is a run that has not finished, the host's approval
      # states included, and a round can still come out of it.
      *) sleep "$interval"; continue ;;
    esac
  fi
  if $done || $dead_run || [ "$waited" -ge "$timeout" ]; then
    out=$(jq -n --arg sha "$sha" --arg m "$mergeable" --argjson c "$checks" --argjson r "$reviews" \
      --argjson t "$threads" --argjson b "$blocked" --argjson rr "$reviewer_run" \
      --argjson lb "$landed_by" --argjson d "$done" --argjson w "$waited" \
      '{head_sha: $sha, mergeable: $m, checks: $c, reviews: $r, threads: $t, reviewer_blocked: $b,
        reviewer_run: $rr, landed_by: $lb, done: $d, waited_s: $w}')
    if $brief; then
      key=on_head; [ -z "$since" ] || key=all
      ship_brief "$out" "$me" "$key" "$full"
    else
      printf '%s\n' "$out"
    fi
    $done
    exit
  fi
  sleep "$interval"
done
