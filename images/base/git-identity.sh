#!/usr/bin/env bash
# Automatically configures git user.name and user.email from the user's LDAP
# profile on first interactive login to a container. Subsequent logins skip
# this entirely once git config is set.
#
# The name is read from the NSS gecos field (mapped from LDAP cn via sssd.conf).
# The email is read from LDAP via an anonymous ldapsearch (REQUIRE_AUTH_FOR_SEARCH
# is disabled on the internal ldap-gateway, so no bind credentials are needed).

# Only run for interactive shells
[[ $- != *i* ]] && return

# Only if git is available
command -v git >/dev/null 2>&1 || return
command -v ldapsearch >/dev/null 2>&1 || return

# Skip if already configured — user-set values always take precedence
[ -n "$(git config --global user.email 2>/dev/null)" ] && [ -n "$(git config --global user.name 2>/dev/null)" ] && return

_GIT_SETUP_USER="${USER:-$(id -un 2>/dev/null)}"
[ -z "$_GIT_SETUP_USER" ] && return
[ "$_GIT_SETUP_USER" = "root" ] && return

# Full name from NSS (SSSD reads the LDAP gecos attribute by default via ldap_user_gecos)
_GIT_SETUP_NAME=$(getent passwd "$_GIT_SETUP_USER" 2>/dev/null | cut -d: -f5)

# Email from LDAP anonymous query
_GIT_SETUP_LDAP_HOST="${LDAP_URI:-ldaps://ldap1:636}"

# Resolve baseDN the same way SSSD does: rootDSE namingContexts autodiscovery.
# Use LDAP_BASE_DN if explicitly set; otherwise query rootDSE.
# - Single namingContexts entry  -> use it directly
# - Multiple namingContexts      -> use defaultNamingContext
# - Neither resolvable           -> abort
if [ -n "${LDAP_BASE_DN:-}" ]; then
    _GIT_SETUP_LDAP_BASE="$LDAP_BASE_DN"
else
    _GIT_SETUP_ROOTDSE=$(ldapsearch -x -H "$_GIT_SETUP_LDAP_HOST" -b "" -s base namingContexts defaultNamingContext 2>/dev/null)
    _GIT_SETUP_NC_COUNT=$(echo "$_GIT_SETUP_ROOTDSE" | grep -c '^namingContexts:')
    if [ "$_GIT_SETUP_NC_COUNT" -eq 1 ]; then
        _GIT_SETUP_LDAP_BASE=$(echo "$_GIT_SETUP_ROOTDSE" | awk '/^namingContexts:/{print $2; exit}')
    elif [ "$_GIT_SETUP_NC_COUNT" -gt 1 ]; then
        _GIT_SETUP_LDAP_BASE=$(echo "$_GIT_SETUP_ROOTDSE" | awk '/^defaultNamingContext:/{print $2; exit}')
    fi
    unset _GIT_SETUP_ROOTDSE _GIT_SETUP_NC_COUNT
fi
[ -z "${_GIT_SETUP_LDAP_BASE:-}" ] && return

_GIT_SETUP_EMAIL=$(ldapsearch -x \
    -H "$_GIT_SETUP_LDAP_HOST" \
    -b "$_GIT_SETUP_LDAP_BASE" \
    "(uid=${_GIT_SETUP_USER})" mail 2>/dev/null \
    | awk '/^mail:/{print $2; exit}')

if [ -n "$_GIT_SETUP_NAME" ]; then
    git config --global user.name  "$_GIT_SETUP_NAME"
fi

if [ -n "$_GIT_SETUP_EMAIL" ]; then
    git config --global user.email "$_GIT_SETUP_EMAIL"
fi

unset _GIT_SETUP_USER _GIT_SETUP_NAME _GIT_SETUP_EMAIL _GIT_SETUP_LDAP_HOST _GIT_SETUP_LDAP_BASE _GIT_SETUP_ROOTDSE _GIT_SETUP_NC_COUNT
