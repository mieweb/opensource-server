#!/usr/bin/env bash
# Stamp a single version into every proxy-auth-lib package manifest.
#
#   ./stamp-version.sh 1.2.3
#
# Portable (perl) in-place edits so the same command runs on macOS and Linux/CI.
# The Go module carries no version field — it is released via a git tag.
set -euo pipefail

version="${1:?usage: stamp-version.sh <version>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TPA_VERSION="$version"

# Node / npm + JSR (same exported package, two registries)
perl -pi -e 's/("version":\s*)"[^"]*"/$1"$ENV{TPA_VERSION}"/ if !$d && /"version"/ and $d=1' \
  "$root/nodejs/package.json"
perl -pi -e 's/("version":\s*)"[^"]*"/$1"$ENV{TPA_VERSION}"/ if !$d && /"version"/ and $d=1' \
  "$root/nodejs/jsr.json"

# Python (pyproject [project] version)
perl -pi -e 's/^version = "[^"]*"/version = "$ENV{TPA_VERSION}"/' \
  "$root/python/pyproject.toml"

# Rust ([package] version — anchored so dependency versions are untouched)
perl -pi -e 's/^version = "[^"]*"/version = "$ENV{TPA_VERSION}"/' \
  "$root/rust/Cargo.toml"

# Meteor (package version + the audited npm core it depends on)
perl -pi -e "s/(version:\\s*)'[^']*'/\${1}'\$ENV{TPA_VERSION}'/ if !\$d && /version:/ and \$d=1" \
  "$root/meteor/accounts-proxy-auth/package.js"
perl -pi -e "s/('\@mieweb\/trusted-proxy-auth':\s*)'[^']*'/\${1}'\$ENV{TPA_VERSION}'/" \
  "$root/meteor/accounts-proxy-auth/package.js"

echo "Stamped proxy-auth-lib packages to v$version"
