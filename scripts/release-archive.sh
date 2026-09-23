#!/usr/bin/env bash
# Builds and checks the release archive (ADR-0006): the zip of the *contents* of
# plugin/, attached to the GitHub Release the fleet installs from.
#
#   scripts/release-archive.sh build <out-dir> [<version>]
#   scripts/release-archive.sh check <zip>
#
# build stages the tracked plugin files minus tests and, given <version>, writes
# it into the staged manifest with the release's own writer. The zip is named
# from the staged manifest, so the manifest version stays the only copy. It then
# runs check and writes <zip>.sha256 beside it. stdout carries release-notes
# markdown and nothing else, because @semantic-release/exec's generateNotesCmd
# appends stdout to the notes; logs go to stderr. generateNotes runs before
# prepare, which is why the version is stamped into a staged copy rather than
# read from the committed manifest; prepareCmd then compares the two. It runs
# again after @semantic-release/git commits, so the zip is rebuilt from the
# release commit and the uploaded zip and the sha256 in the notes always come
# from the same build.
#
# check refuses a zip whose root is not the plugin directory's contents, has no
# hooks/, carries a test file, or whose manifest version disagrees with the
# version in its file name. Whether the engine tolerates any other root is
# unmeasured, so the check holds the layout ADR-0006 fixes; the asset name is
# what the console's URL is built from.
#
# exit: 0 ok · 1 a check failed · 2 usage
set -uo pipefail

repo="Gharib89/ratelimit-otel"
manifest=".claude-plugin/plugin.json"

fail() { echo "release-archive: $*" >&2; exit 1; }

check() {
  local zip=$1 entries tests version
  entries=$(unzip -Z1 "$zip") || fail "$zip: not a readable zip"
  grep -q '^hooks/' <<<"$entries" || fail "$zip: no hooks/ at the zip root"
  tests=$(grep -E '\.test\.tsx?$' <<<"$entries")
  [ -z "$tests" ] || fail "$zip: carries test files: $(tr '\n' ' ' <<<"$tests")"
  version=$(unzip -p "$zip" "$manifest" | jq -er '.version | strings') \
    || fail "$zip: no $manifest with a string version at the zip root"
  local base=${zip##*/} named
  case $base in
    ratelimit-otel-*.zip)
      named=${base#ratelimit-otel-}; named=${named%.zip}
      [ "$named" = "$version" ] || fail "$zip: named $named but its manifest says $version" ;;
  esac
}

build() {
  local out=$1 version=${2:-} root name sha
  root=$(git rev-parse --show-toplevel) || fail "not inside a git checkout"
  mkdir -p "$out" && out=$(cd "$out" && pwd) || fail "cannot create $out"
  # Global, not local: the EXIT trap runs after build has returned.
  stage=$(mktemp -d) || fail "mktemp failed"
  trap 'rm -rf "$stage"' EXIT

  # Tracked files only, so a stray local file never ships; tests stay out.
  git -C "$root" ls-files -z -- plugin ':(exclude,glob)**/*.test.ts' ':(exclude,glob)**/*.test.tsx' \
    | tar -C "$root" --null -T - -cf - | tar -C "$stage" -xf - || fail "staging plugin/ failed"
  if [ -n "$version" ]; then
    # The writer resolves plugin/.claude-plugin/plugin.json against its cwd.
    ( cd "$stage" && node "$root/scripts/set-manifest-version.mjs" "$version" >&2 ) \
      || fail "writing version $version into the staged manifest failed"
  fi
  version=$(jq -er '.version | strings' "$stage/plugin/$manifest") \
    || fail "plugin/$manifest has no string version"

  name="ratelimit-otel-$version.zip"
  rm -f "$out/$name" "$out/$name.sha256"
  ( cd "$stage/plugin" && zip -q -X -r "$out/$name" . ) || fail "zip failed"
  check "$out/$name"
  ( cd "$out" && sha256sum "$name" >"$name.sha256" ) || fail "sha256sum failed"
  sha=$(cut -d' ' -f1 "$out/$name.sha256")
  echo "built $out/$name ($sha)" >&2

  cat <<EOF
### Release archive

- URL: https://github.com/$repo/releases/download/ratelimit-otel--v$version/$name
- sha256: \`$sha\`
EOF
}

case ${1:-} in
  build) [ $# -ge 2 ] && [ $# -le 3 ] || { echo "usage: $0 build <out-dir> [<version>]" >&2; exit 2; }; build "$2" "${3:-}" ;;
  check) [ $# -eq 2 ] || { echo "usage: $0 check <zip>" >&2; exit 2; }; check "$2" ;;
  *) echo "usage: $0 build <out-dir> [<version>] | check <zip>" >&2; exit 2 ;;
esac
