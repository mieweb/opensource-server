#!/usr/bin/env bash
# Publish the Rust crate trusted-proxy-auth to crates.io.
# Requires CARGO_REGISTRY_TOKEN in the environment.
set -euo pipefail
version="${1:?usage: publish-crates.sh <version>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$here/stamp-version.sh" "$version"
cd "$here/../rust"
cargo publish --allow-dirty
