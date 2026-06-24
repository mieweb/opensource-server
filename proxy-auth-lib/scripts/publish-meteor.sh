#!/usr/bin/env bash
# Publish the Meteor package mieweb:accounts-proxy-auth to Atmosphere.
# Requires a logged-in Meteor session: in CI restore METEOR_SESSION, locally
# run `meteor login` first. Pass --create on the very first publish.
set -euo pipefail
version="${1:?usage: publish-meteor.sh <version> [--create]}"
shift || true
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$here/stamp-version.sh" "$version"
cd "$here/../meteor/accounts-proxy-auth"
meteor publish "$@"
