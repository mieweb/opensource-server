#!/usr/bin/env bash
# Automatically configures git user.name and user.email from the user's LDAP
# profile on first interactive login to a container. Subsequent logins skip
# this entirely once git config is set.
#
# The name is read from the NSS gecos field (mapped from LDAP via sssd.conf).
# The email is looked up with ldapsearch, driven by the same SSSD_* environment
# variables that render /etc/sssd/sssd.conf (see sssd.conf.template), so the
# query targets the same directory — and binds with the same credentials — that
# sssd authenticates against.

# Only run for interactive shells
[[ $- != *i* ]] && return

# Only if git and ldapsearch are available
command -v git >/dev/null 2>&1 || return
command -v ldapsearch >/dev/null 2>&1 || return

# Skip if already configured — user-set values always take precedence
[ -n "$(git config --global user.email 2>/dev/null)" ] && [ -n "$(git config --global user.name 2>/dev/null)" ] && return

_git_identity_setup() {
    local user uri base name_attr rootdse nc_count name email
    local -a bind

    user="${USER:-$(id -un 2>/dev/null)}"
    [ -z "$user" ] && return
    [ "$user" = "root" ] && return

    # Same server list sssd uses (ldapsearch -H accepts a comma-separated list).
    # LDAP_URI is the legacy pre-SSSD_* variable name.
    uri="${SSSD_LDAP_URI:-${LDAP_URI:-ldaps://ldap1:636}}"

    # Bind the same way sssd does: with the default bind DN and token when
    # configured (directories such as the Authentik LDAP outpost reject
    # anonymous searches), otherwise anonymously.
    bind=(-x)
    if [ -n "${SSSD_LDAP_DEFAULT_BIND_DN:-}" ] && [ -n "${SSSD_DEFAULT_AUTHTOK:-}" ] &&
        { [ -z "${SSSD_DEFAULT_AUTHTOK_TYPE:-}" ] || [ "${SSSD_DEFAULT_AUTHTOK_TYPE}" = "password" ]; }; then
        bind+=(-D "$SSSD_LDAP_DEFAULT_BIND_DN" -w "$SSSD_DEFAULT_AUTHTOK")
    fi

    # Resolve the search base the same way sssd does: explicit configuration
    # first, then rootDSE namingContexts autodiscovery.
    # - Single namingContexts entry  -> use it directly
    # - Multiple namingContexts      -> use defaultNamingContext
    # - Neither resolvable           -> abort
    base="${SSSD_LDAP_USER_SEARCH_BASE:-${SSSD_LDAP_SEARCH_BASE:-${LDAP_BASE_DN:-}}}"
    if [ -z "$base" ]; then
        rootdse=$(ldapsearch "${bind[@]}" -H "$uri" -b "" -s base namingContexts defaultNamingContext 2>/dev/null)
        nc_count=$(echo "$rootdse" | grep -c '^namingContexts:')
        if [ "$nc_count" -eq 1 ]; then
            base=$(echo "$rootdse" | awk '/^namingContexts:/{print $2; exit}')
        elif [ "$nc_count" -gt 1 ]; then
            base=$(echo "$rootdse" | awk '/^defaultNamingContext:/{print $2; exit}')
        fi
    fi
    [ -z "$base" ] && return

    # Same login-name attribute sssd maps (ldap_user_name, default uid)
    name_attr="${SSSD_LDAP_USER_NAME:-uid}"

    # Full name from NSS (sssd maps the LDAP gecos attribute via ldap_user_gecos)
    name=$(getent passwd "$user" 2>/dev/null | cut -d: -f5)

    email=$(ldapsearch "${bind[@]}" \
        -H "$uri" \
        -b "$base" \
        "(${name_attr}=${user})" mail 2>/dev/null \
        | awk '/^mail:/{print $2; exit}')

[ -n "$name" ] && [ -z "$(git config --global user.name 2>/dev/null)" ] && git config --global user.name "$name"
[ -n "$email" ] && [ -z "$(git config --global user.email 2>/dev/null)" ] && git config --global user.email "$email"
    return 0
}

_git_identity_setup
unset -f _git_identity_setup
