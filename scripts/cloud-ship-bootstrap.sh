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
# it; the sandbox image puts it there. The release tarball is checked against
# the release's own checksums.txt before anything is extracted.
#
# exit: 0 gitleaks on PATH · 1 download, checksum, platform or PATH failure
set -euo pipefail

version=8.30.1
bin_dir="$HOME/.local/bin"

if command -v gitleaks >/dev/null; then
  exit 0
fi

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_x64 ;;
  Linux-aarch64 | Linux-arm64) platform=linux_arm64 ;;
  Darwin-x86_64) platform=darwin_x64 ;;
  Darwin-arm64) platform=darwin_arm64 ;;
  *) echo "cloud-ship-bootstrap: no gitleaks $version release asset for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
tarball="gitleaks_${version}_${platform}.tar.gz"
sums="gitleaks_${version}_checksums.txt"
url="https://github.com/gitleaks/gitleaks/releases/download/v$version"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$tarball" "$url/$tarball"
curl -fsSL -o "$tmp/$sums" "$url/$sums"

# Exact-name match, so a missing line fails here rather than as an empty check.
awk -v f="$tarball" '$2 == f' "$tmp/$sums" >"$tmp/expected"
[ -s "$tmp/expected" ] || { echo "cloud-ship-bootstrap: $sums has no line for $tarball" >&2; exit 1; }
if command -v sha256sum >/dev/null; then check=(sha256sum); else check=(shasum -a 256); fi
( cd "$tmp" && "${check[@]}" --status -c expected ) \
  || { echo "cloud-ship-bootstrap: $tarball does not match $sums; nothing installed" >&2; exit 1; }

tar -xzf "$tmp/$tarball" -C "$tmp" gitleaks
mkdir -p "$bin_dir"
install -m 0755 "$tmp/gitleaks" "$bin_dir/gitleaks"

command -v gitleaks >/dev/null \
  || { echo "cloud-ship-bootstrap: installed $bin_dir/gitleaks, but $bin_dir is not on PATH" >&2; exit 1; }
