#!/usr/bin/env bash
# "Publish" the Go module. Go modules are released purely by a version tag.
# For a module in a subdirectory the tag must be prefixed with that path, so
# github.com/mieweb/opensource-server/proxy-auth-lib/go resolves to the tag
# proxy-auth-lib/go/v<version>. After tagging we warm the public module proxy
# so `go get` and pkg.go.dev see the release immediately.
set -euo pipefail
version="${1:?usage: publish-go.sh <version>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

module="github.com/mieweb/opensource-server/proxy-auth-lib/go"
tag="proxy-auth-lib/go/v${version}"

cd "$here/.."
go -C go vet ./...

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Tag $tag already exists; skipping tag creation"
else
  git tag "$tag"
  git push origin "$tag"
fi

# Trigger indexing on the Go module proxy (best effort).
curl -fsSL "https://proxy.golang.org/${module}/@v/v${version}.info" \
  && echo "Go module ${module}@v${version} indexed"
