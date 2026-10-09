#!/usr/bin/env bash
# Write the container's environment (PID 1's, where the Manager puts the
# container's env vars) to /run/mieweb/env in systemd EnvironmentFile syntax.
#
# The base image's /etc/environment holds raw KEY=value lines, which systemd
# parses with quoting and backslash rules: `{"a":1}` would reach the app as
# `{a:1}` and an unmatched quote could stop a unit from loading. Here every
# value is double-quoted with `\` and `"` escaped, so it arrives byte for byte.
# (The deploy provider rejects values containing line breaks.)
set -euo pipefail
out=/run/mieweb/env
install -d -m 0755 /run/mieweb
tmp=$(mktemp /run/mieweb/env.XXXXXX)
while IFS= read -r -d '' kv; do
  key=${kv%%=*}
  value=${kv#*=}
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
  [[ "$key" == HOME ]] && continue
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '%s="%s"\n' "$key" "$value" >>"$tmp"
done </proc/1/environ
chmod 0600 "$tmp"
mv "$tmp" "$out"
