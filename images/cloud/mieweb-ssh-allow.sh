#!/bin/sh
# Restrict SSH to the accounts in MIEWEB_SSH_ALLOW_USERS (space-separated),
# set by the deploy provider: the container's owner, collaborators and
# deployer. The converged container holds app secrets and datastore files,
# and the base image otherwise lets every LDAP user SSH in with sudo.
#
# Runs before ssh.service at boot; env changes take effect on restart (deploy
# restarts the container when its env changes). Without the variable (e.g. a
# plain `docker run`) SSH is left as the base image configures it.
set -eu
# No globbing: the list is word-split below, and a `*` must not expand to
# file names (which could add e.g. `root`).
set -f
conf=/etc/ssh/sshd_config.d/60-mieweb-allow-users.conf
users=$(sed -n 's/^MIEWEB_SSH_ALLOW_USERS=//p' /etc/environment 2>/dev/null | tail -n 1)
# Keep only literal account names: no sshd patterns (*, ?, !) or separators.
safe=$(printf '%s\n' $users | grep -E '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' | tr '\n' ' ' | sed 's/ *$//')
if [ -n "$safe" ]; then
  printf 'AllowUsers %s\n' "$safe" >"$conf.tmp"
  chmod 0644 "$conf.tmp"
  mv "$conf.tmp" "$conf"
else
  rm -f "$conf"
fi
