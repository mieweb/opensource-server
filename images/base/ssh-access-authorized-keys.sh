#!/usr/bin/env bash
# sshd AuthorizedKeysCommand: only serve a user's LDAP keys if the manager
# says they may log in here. No output = no keys = denied.
/usr/local/bin/ssh-access-check "$1" || exit 0
exec /usr/bin/sss_ssh_authorizedkeys "$1"
