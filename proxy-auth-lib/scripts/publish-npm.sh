#!/usr/bin/env bash
# Publish the npm package @mieweb/trusted-proxy-auth.
# Requires NODE_AUTH_TOKEN (npm automation token) in the environment.
set -euo pipefail
version="${1:?usage: publish-npm.sh <version>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$here/stamp-version.sh" "$version"
cd "$here/../nodejs"
npm publish --access public
