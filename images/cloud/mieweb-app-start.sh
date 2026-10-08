#!/usr/bin/env bash
# app.service helper.
#   prepare  install dependencies (only when package.json or the lockfile
#            changed) and run the `build` script if present (ExecStartPre)
#   run      start the app (ExecStart)
#
# `mieweb deploy` copies the app's worktree into /opt/app/src over SSH and then
# restarts this unit, waiting for `prepare` to finish. Environment (set by the
# deploy provider):
#   MIEWEB_APP_START  start command (default: `npm start`); must listen on $PORT
#   PORT              HTTP port the app listens on (default 8787)
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
  # No lockfile in the app: don't create one here. deploy would delete it on
  # the next sync (it isn't in the worktree), changing the dependency stamp
  # and forcing a full reinstall on every deploy.
  install=(npm install --no-package-lock); run=(npm run)
fi

case "${1:-}" in
  prepare)
    # (Missing lockfiles are expected; don't let `cat` fail the script.)
    deps="$({ cat package.json pnpm-lock.yaml yarn.lock package-lock.json 2>/dev/null || true; } | sha256sum | cut -d' ' -f1)"
    # Reinstall when the manifest/lockfile changed, or node_modules went
    # missing for an app that has dependencies (npm creates none otherwise).
    has_deps=''
    for field in dependencies devDependencies optionalDependencies; do
      [[ "$(npm pkg get "$field")" != "{}" ]] && has_deps=1
    done
    if [[ "$(cat "$DEPS_STAMP" 2>/dev/null || true)" != "$deps" || ( -n "$has_deps" && ! -d node_modules ) ]]; then
      echo "Installing dependencies: ${install[*]}"
      rm -f "$DEPS_STAMP"
      "${install[@]}"
      echo "$deps" >"$DEPS_STAMP"
    fi
    if [[ "$(npm pkg get scripts.build)" != "{}" ]]; then
      echo "Building: ${run[*]} build"
      "${run[@]}" build
    fi
    ;;
  run)
    echo "Starting app on port $PORT"
    exec bash -c "${MIEWEB_APP_START:-npm start}"
    ;;
  *)
    echo "usage: $0 prepare|run" >&2
    exit 2
    ;;
esac
