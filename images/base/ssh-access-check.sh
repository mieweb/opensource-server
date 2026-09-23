#!/usr/bin/env bash
# ssh-access-check [user]
#
# Asks the manager whether <user> may SSH into this container (owner or
# collaborator). Exit 0 = allow, 1 = deny. Runs as the sshd PAM `account` hook
# (pam_exec, user in $PAM_USER); because `UsePAM yes` is in effect the account
# phase runs for publickey and password/MFA logins alike, so this one hook
# gates every path. A username argument ($1) is also accepted for testing.
#
# Enrollment files (written by ssh-access-setup.sh from the container env):
#   /etc/ssh-access/url    manager base URL
#   /etc/ssh-access/id     this container's manager id
#   /etc/ssh-access/token  bearer token (root-only, 0600)
# Without them the container is unenrolled and behaves as before (allow).
#
# Manager unreachable: honour a recent cached allow (touched on every 204) so
# the owner keeps access through an outage while strangers stay out.
set -u

CONF_DIR=${SSH_ACCESS_DIR:-/etc/ssh-access}
CACHE_DIR=${SSH_ACCESS_CACHE_DIR:-/var/cache/ssh-access}
CACHE_TTL=${SSH_ACCESS_CACHE_TTL:-86400}

user=${1:-${PAM_USER:-}}

log() { logger -t ssh-access -p auth.notice -- "$*" 2>/dev/null || echo "ssh-access: $*" >&2; }

if ! [[ "$user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
    log "deny '${user}': invalid username"
    exit 1
fi

if [ ! -s "$CONF_DIR/token" ] || [ ! -s "$CONF_DIR/url" ] || [ ! -s "$CONF_DIR/id" ]; then
    log "allow ${user}: container not enrolled (no ${CONF_DIR}/token)"
    exit 0
fi

url="$(<"$CONF_DIR/url")/api/v1/containers/$(<"$CONF_DIR/id")/ssh-access/${user}"
# Token goes in via curl's config on stdin so it never appears in argv.
code=$(printf 'header = "Authorization: Bearer %s"\n' "$(<"$CONF_DIR/token")" \
    | curl -sS -K - -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null) || code=000

cache="$CACHE_DIR/$user"
case "$code" in
    204)
        mkdir -p "$CACHE_DIR" 2>/dev/null; touch "$cache" 2>/dev/null
        exit 0
        ;;
    403|400)
        rm -f "$cache"
        log "deny ${user}: not owner or collaborator (${code})"
        exit 1
        ;;
    *)
        # 000 (unreachable), 5xx, or 401 (our token no longer valid): can't verify.
        if [ -f "$cache" ] && [ $(( $(date +%s) - $(date -r "$cache" +%s) )) -lt "$CACHE_TTL" ]; then
            log "allow ${user}: manager unavailable (${code}), cached allow"
            exit 0
        fi
        log "deny ${user}: manager unavailable (${code}), no cached allow"
        exit 1
        ;;
esac
