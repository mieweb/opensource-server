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
[ -n "$(git config --global user.email 2>/dev/null)" ] && return

_GIT_SETUP_USER="${USER:-$(id -un 2>/dev/null)}"
[ -z "$_GIT_SETUP_USER" ] && return

# Full name from NSS (SSSD maps LDAP cn -> gecos via ldap_user_gecos = cn)
_GIT_SETUP_NAME=$(getent passwd "$_GIT_SETUP_USER" 2>/dev/null | cut -d: -f5)

# Email from LDAP anonymous query
_GIT_SETUP_LDAP_HOST="${LDAP_URI:-ldaps://ldap1:636}"
_GIT_SETUP_LDAP_BASE="${LDAP_BASE_DN:-dc=docker,dc=internal}"
_GIT_SETUP_EMAIL=$(ldapsearch -x \
    -H "$_GIT_SETUP_LDAP_HOST" \
    -b "$_GIT_SETUP_LDAP_BASE" \
    "(uid=${_GIT_SETUP_USER})" mail 2>/dev/null \
    | awk '/^mail:/{print $2; exit}')

if [ -n "$_GIT_SETUP_NAME" ] && [ -n "$_GIT_SETUP_EMAIL" ]; then
    git config --global user.name  "$_GIT_SETUP_NAME"
    git config --global user.email "$_GIT_SETUP_EMAIL"
fi

unset _GIT_SETUP_USER _GIT_SETUP_NAME _GIT_SETUP_EMAIL _GIT_SETUP_LDAP_HOST _GIT_SETUP_LDAP_BASE
