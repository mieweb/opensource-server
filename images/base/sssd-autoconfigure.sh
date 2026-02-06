#!/bin/bash
# sssd-autoconfigure — Generate /etc/sssd/sssd.conf from DHCP search domain
set -euo pipefail

RESOLV_CONF="/etc/resolv.conf"
SSSD_CONF="/etc/sssd/sssd.conf"

# Extract the first search domain from resolv.conf
search_domain=$(awk '/^(search|domain)/ { print $2; exit }' "$RESOLV_CONF")

if [ -z "$search_domain" ]; then
    echo "sssd-autoconfigure: No search domain found in $RESOLV_CONF" >&2
    exit 1
fi

# Transform "example.mieweb.com" → "dc=example,dc=mieweb,dc=com"
ldap_search_base=$(echo "$search_domain" | sed 's/\./,dc=/g; s/^/dc=/')

echo "sssd-autoconfigure: domain=$search_domain base=$ldap_search_base"

cat > "$SSSD_CONF" <<EOF
[sssd]
domains = default

[domain/default]
id_provider = ldap
auth_provider = ldap
access_provider = ldap
ldap_uri = ldaps://ldap.${search_domain}
ldap_search_base = ${ldap_search_base}
ldap_tls_reqcert = allow
EOF

chmod 0600 "$SSSD_CONF"
chown root:root "$SSSD_CONF"

echo "sssd-autoconfigure: Wrote $SSSD_CONF"
