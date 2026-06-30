#!/usr/bin/env bash
# Publish the same package to JSR (jsr.io) for Deno/Bun/Node consumers.
# In GitHub Actions authentication is via OIDC (id-token: write) — no token.
# Locally, `npx jsr publish` opens a browser to authenticate.
set -euo pipefail
version="${1:?usage: publish-jsr.sh <version>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$here/stamp-version.sh" "$version"
cd "$here/../nodejs"
npx --yes jsr publish --allow-dirty
