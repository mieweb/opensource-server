#!/usr/bin/env bash
# Smoke test: prove the published npm package installs and imports cleanly under
# Bun and Deno (both resolve it from the npm registry). Run after the npm
# publish has propagated. Pass the version to pin the install.
set -euo pipefail
version="${1:?usage: smoke-runtimes.sh <version>}"
pkg="@mieweb/trusted-proxy-auth@${version}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

if command -v bun >/dev/null 2>&1; then
  echo "== bun =="
  bun init -y >/dev/null
  bun add "$pkg"
  bun --eval "import { loadConfigFromEnv } from '@mieweb/trusted-proxy-auth'; if (typeof loadConfigFromEnv !== 'function') process.exit(1); console.log('bun ok');"
else
  echo "bun not installed; skipping bun smoke test" >&2
fi

if command -v deno >/dev/null 2>&1; then
  echo "== deno =="
  deno eval "import { loadConfigFromEnv } from 'npm:${pkg}'; if (typeof loadConfigFromEnv !== 'function') Deno.exit(1); console.log('deno ok');"
else
  echo "deno not installed; skipping deno smoke test" >&2
fi
