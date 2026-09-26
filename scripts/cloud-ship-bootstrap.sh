#!/usr/bin/env bash
# The ship profile's `## Cloud lane` `Bootstrap:`: installs the scanner the local
# gate's `secrets` gate runs, because the cloud sandbox image ships without it
# and that gate is required in every lane, so without it every cloud /ship run
# stops at the local gate with `local gate unavailable: secrets`.
#
#   scripts/cloud-ship-bootstrap.sh
#
# ship's prepare step runs it at the start of every run in a cloud sandbox and
# of any `ship --unattended`, local included, so it must be safe to rerun and
# safe on a workstation: any gitleaks already on PATH is left alone, and the
# install goes to $HOME/.local/bin with no sudo. That directory has to be on
# PATH already, since prepare runs this in a child shell whose PATH dies with
# it; the sandbox image puts it there, and the script refuses before writing
# anything where it is not. The release tarball's sha256 is compared with the
# release's own checksums file before anything is extracted.
#
# exit: 0 gitleaks on PATH · 1 platform, PATH, download or checksum failure
set -uo pipefail

version=8.30.1
bin_dir="$HOME/.local/bin"

fail() { echo "cloud-ship-bootstrap: $*" >&2; exit 1; }

command -v gitleaks >/dev/null && exit 0

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_x64 ;;
  Linux-aarch64) platform=linux_arm64 ;;
  Darwin-x86_64) platform=darwin_x64 ;;
  Darwin-arm64) platform=darwin_arm64 ;;
  *) fail "no gitleaks $version release asset for $(uname -s) $(uname -m)" ;;
esac
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) fail "$bin_dir is not on PATH, so an install there would not reach the local gate" ;;
esac
tarball="gitleaks_${version}_${platform}.tar.gz"
sums="gitleaks_${version}_checksums.txt"
url="https://github.com/gitleaks/gitleaks/releases/download/v$version"

tmp=$(mktemp -d) || fail "mktemp failed"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$tarball" "$url/$tarball" || fail "download failed: $url/$tarball"
curl -fsSL -o "$tmp/$sums" "$url/$sums" || fail "download failed: $url/$sums"

# Exact-name match on the `<sha256>  <file>` lines, so a missing line fails here
# rather than comparing against nothing.
expected=$(awk -v f="$tarball" '$2 == f { print $1 }' "$tmp/$sums")
[ -n "$expected" ] || fail "$sums has no line for $tarball"
if command -v sha256sum >/dev/null; then
  actual=$(sha256sum "$tmp/$tarball")
else
  actual=$(shasum -a 256 "$tmp/$tarball")
fi
[ "${actual%% *}" = "$expected" ] || fail "$tarball does not match $sums; nothing installed"

tar -xzf "$tmp/$tarball" -C "$tmp" gitleaks || fail "cannot extract gitleaks from $tarball"
mkdir -p "$bin_dir" && install -m 0755 "$tmp/gitleaks" "$bin_dir/gitleaks" \
  || fail "cannot install $bin_dir/gitleaks"
