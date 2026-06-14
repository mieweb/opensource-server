#!/bin/sh
# Compose a package-format-specific version string from version parts.
#
# Usage: nfpm-version.sh <packager> <version> <prerelease> <count> <hash> <dirty>
#   packager    deb | rpm | apk
#   version     base version, e.g. 2026.6.3 (no leading v)
#   prerelease  e.g. rc1, or empty
#   count       commits since the tag (0 on an exact tag)
#   hash        short commit hash, e.g. g8192107 (empty if no tag)
#   dirty       1 if the working tree is dirty, else 0
#
# Each format has different version grammar, so the separators differ:
#   prerelease : deb/rpm use ~<pre> (sorts below the release); apk uses _<pre>
#   snapshot   : deb uses +<count>.<hash> (build metadata); rpm uses
#                ^<count>.<hash> (post-release, sorts above); apk uses
#                _git<count> (apk cannot carry the hash)
#   dirty      : appended as .dirty for deb/rpm; ignored for apk
set -eu

packager=$1
version=$2
prerelease=${3:-}
count=${4:-0}
hash=${5:-}
dirty=${6:-0}

case "$packager" in
    deb)
        v=$version
        [ -n "$prerelease" ] && v="$v~$prerelease"
        if [ "$count" != "0" ]; then
            v="$v+$count.$hash"
            [ "$dirty" = "1" ] && v="$v.dirty"
        elif [ "$dirty" = "1" ]; then
            v="$v+dirty"
        fi
        ;;
    rpm)
        v=$version
        [ -n "$prerelease" ] && v="$v~$prerelease"
        if [ "$count" != "0" ]; then
            v="$v^$count.$hash"
            [ "$dirty" = "1" ] && v="$v.dirty"
        elif [ "$dirty" = "1" ]; then
            v="$v^dirty"
        fi
        ;;
    apk)
        # apk grammar is restrictive: digits(.digits)*[_suffix[digits]]* — it
        # cannot embed the commit hash, so snapshots use _git<count>.
        v=$version
        [ -n "$prerelease" ] && v="${v}_$prerelease"
        [ "$count" != "0" ] && v="${v}_git$count"
        ;;
    *)
        echo "nfpm-version: unknown packager '$packager'" >&2
        exit 1
        ;;
esac

printf '%s\n' "$v"
