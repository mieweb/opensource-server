#!/usr/bin/env bash
# Install, build and run the deployed app (app.service ExecStart).
#
# `mieweb deploy` copies the app's worktree into /opt/app/src over SSH and then
# restarts this unit. Environment (set by the deploy provider):
#   MIEWEB_APP_START  start command (default: `npm start`); must listen on $PORT
#   PORT              HTTP port the app listens on (default 8787)
#
# Dependencies are reinstalled only when package.json or the lockfile change.
set -euo pipefail

APP_DIR=/opt/app/src
DEPS_STAMP=/opt/app/.deps-stamp
export PORT="${PORT:-8787}"
cd "$APP_DIR"

if [[ -f pnpm-lock.yaml ]]; then
  install=(corepack pnpm install --frozen-lockfile); run=(corepack pnpm run)
elif [[ -f yarn.lock ]]; then
  install=(corepack yarn install --immutable); run=(corepack yarn run)
elif [[ -f package-lock.json ]]; then
  install=(npm ci); run=(npm run)
else
  install=(npm install); run=(npm run)
fi

# (Missing lockfiles are expected; don't let `cat` fail the script.)
deps="$({ cat package.json pnpm-lock.yaml yarn.lock package-lock.json 2>/dev/null || true; } | sha256sum | cut -d' ' -f1)"
if [[ ! -d node_modules || "$(cat "$DEPS_STAMP" 2>/dev/null || true)" != "$deps" ]]; then
  echo "Installing dependencies: ${install[*]}"
  "${install[@]}"
  echo "$deps" >"$DEPS_STAMP"
fi

if [[ "$(npm pkg get scripts.build)" != "{}" ]]; then
  "${run[@]}" build
fi

echo "Starting app on port $PORT"
exec bash -c "${MIEWEB_APP_START:-npm start}"
