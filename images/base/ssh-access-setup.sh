#!/usr/bin/env bash
# Boot-time enrollment: copy the SSH-access callback settings from PID 1's
# environment (set by the manager on the LXC config) into /etc/ssh-access so
# ssh-access-check can read them without the token ever landing in the
# world-readable /etc/environment. Idempotent; a no-op when the vars are absent
# (container created before this feature — SSH stays open until enrolled).
set -euo pipefail

CONF_DIR=/etc/ssh-access
CACHE_DIR=/var/cache/ssh-access

getenv() { tr '\0' '\n' </proc/1/environ | sed -n "s/^$1=//p" | head -n1; }

token=$(getenv CONTAINER_SSH_TOKEN)
url=$(getenv MANAGER_URL)
id=$(getenv CONTAINER_ID)

if [ -z "$token" ] || [ -z "$url" ] || [ -z "$id" ]; then
    echo "ssh-access: CONTAINER_SSH_TOKEN/MANAGER_URL/CONTAINER_ID not all set — not enrolled"
    exit 0
fi

install -d -m 0700 -o root -g root "$CONF_DIR"
install -d -m 0700 -o root -g root "$CACHE_DIR"
printf '%s\n' "${url%/}" >"$CONF_DIR/url.tmp"
printf '%s\n' "$id" >"$CONF_DIR/id.tmp"
(umask 077; printf '%s\n' "$token" >"$CONF_DIR/token.tmp")
for f in url id token; do mv -f "$CONF_DIR/$f.tmp" "$CONF_DIR/$f"; done
echo "ssh-access: enrolled as container $id with $url"
