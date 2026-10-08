#!/bin/sh
# Restrict SSH to the accounts in MIEWEB_SSH_ALLOW_USERS (space-separated),
# set by the deploy provider: the container's owner, collaborators and
# deployer. The converged container holds app secrets and datastore files,
# and the base image otherwise lets every LDAP user SSH in with sudo.
#
# Runs before ssh.service at boot; env changes take effect on restart (deploy
# restarts the container when its env changes).
#   - variable absent (e.g. a plain `docker run`): SSH is left as the base
#     image configures it;
#   - variable present: only the listed accounts may log in. If it is present
#     but yields no usable name, nobody may (fail closed), never everybody.
set -eu
# No globbing: the list is word-split below, and a `*` must not expand to
# file names (which could add e.g. `root`).
set -f
conf=/etc/ssh/sshd_config.d/60-mieweb-allow-users.conf

if ! grep -q '^MIEWEB_SSH_ALLOW_USERS=' /etc/environment 2>/dev/null; then
  rm -f "$conf"
  exit 0
fi
users=$(sed -n 's/^MIEWEB_SSH_ALLOW_USERS=//p' /etc/environment | tail -n 1)

# Keep only literal account names: no sshd patterns (*, ?, !) or separators.
safe=''
for u in $users; do
  if printf '%s' "$u" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$'; then
    safe="$safe $u"
  else
    echo "mieweb-ssh-allow: ignoring unsupported account name '$u'" >&2
  fi
done
safe=${safe# }

if [ -n "$safe" ]; then
  rule="AllowUsers $safe"
else
  echo 'mieweb-ssh-allow: no usable account names; denying all SSH logins' >&2
  rule='DenyUsers *'
fi
printf '%s\n' "$rule" >"$conf.tmp"
chmod 0644 "$conf.tmp"
mv "$conf.tmp" "$conf"
