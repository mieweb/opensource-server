#!/usr/bin/env bash
# Smoke test for images/base/git-identity.sh with stubbed ldapsearch/getent.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/git-identity.sh"
export SCRIPT
STUBS=$(mktemp -d)
export HOME=$(mktemp -d)

cat >"$STUBS/ldapsearch" <<'EOF'
#!/usr/bin/env bash
# Record args for assertions, then answer rootDSE or mail queries.
echo "$@" >>/tmp/ldapsearch-args.log
if [[ "$*" == *"-s base namingContexts"* ]]; then
    echo "namingContexts: dc=example,dc=com"
    exit 0
fi
echo "mail: tester@example.com"
EOF

cat >"$STUBS/getent" <<'EOF'
#!/usr/bin/env bash
echo "tester:x:2000:4000:Testy McTestface:/home/tester:/bin/bash"
EOF

chmod +x "$STUBS/ldapsearch" "$STUBS/getent"
export PATH="$STUBS:$PATH"
export USER=tester
rm -f /tmp/ldapsearch-args.log

fail=0
check() { # desc expected actual
    if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (expected '$2', got '$3')"; fail=1; fi
}

# --- Case 1: SSSD_* vars set incl. bind creds; explicit user search base ---
export SSSD_LDAP_URI="ldaps://a:636, ldaps://b:636"
export SSSD_LDAP_USER_SEARCH_BASE="ou=people,dc=example,dc=com"
export SSSD_LDAP_DEFAULT_BIND_DN="cn=proxy,dc=example,dc=com"
export SSSD_DEFAULT_AUTHTOK_TYPE="password"
export SSSD_DEFAULT_AUTHTOK="secret"
export SSSD_LDAP_USER_NAME="sAMAccountName"

bash -ic '. "$SCRIPT"'
check "email set" "tester@example.com" "$(git config --global user.email)"
check "name set" "Testy McTestface" "$(git config --global user.name)"
grep -q -- "-D cn=proxy,dc=example,dc=com -w secret" /tmp/ldapsearch-args.log && echo "PASS: bound with sssd creds" || { echo "FAIL: bind creds missing"; fail=1; }
grep -q -- "-b ou=people,dc=example,dc=com (sAMAccountName=tester) mail" /tmp/ldapsearch-args.log && echo "PASS: base + name attr honored" || { echo "FAIL: base/name attr"; fail=1; }
grep -q -- "-H ldaps://a:636, ldaps://b:636" /tmp/ldapsearch-args.log && echo "PASS: SSSD_LDAP_URI used" || { echo "FAIL: uri"; fail=1; }

# --- Case 2: no base configured -> rootDSE discovery, anonymous bind ---
git config --global --unset user.email; git config --global --unset user.name
unset SSSD_LDAP_USER_SEARCH_BASE SSSD_LDAP_DEFAULT_BIND_DN SSSD_DEFAULT_AUTHTOK SSSD_DEFAULT_AUTHTOK_TYPE SSSD_LDAP_USER_NAME
rm -f /tmp/ldapsearch-args.log

bash -ic '. "$SCRIPT"'
check "email via rootDSE base" "tester@example.com" "$(git config --global user.email)"
grep -q -- "-b dc=example,dc=com (uid=tester) mail" /tmp/ldapsearch-args.log && echo "PASS: rootDSE base + default uid attr" || { echo "FAIL: rootDSE"; fail=1; }
grep -q -- "-D " /tmp/ldapsearch-args.log && { echo "FAIL: unexpected bind"; fail=1; } || echo "PASS: anonymous when no creds"

# --- Case 3: existing config untouched ---
git config --global user.email keep@me.com
git config --global user.name "Keep Me"
rm -f /tmp/ldapsearch-args.log
bash -ic '. "$SCRIPT"'
check "existing email kept" "keep@me.com" "$(git config --global user.email)"
[ -f /tmp/ldapsearch-args.log ] && { echo "FAIL: ldapsearch ran despite existing config"; fail=1; } || echo "PASS: skipped when already configured"

# --- Case 4: non-interactive shell does nothing ---
git config --global --unset user.email; git config --global --unset user.name
bash -c '. "$SCRIPT"'
check "non-interactive no-op" "" "$(git config --global user.email 2>/dev/null)"

exit $fail
