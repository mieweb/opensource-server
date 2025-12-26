#!/bin/bash
# /var/lib/vz/snippets/register_proxy_hook.sh

echo "GUEST HOOK: $*"

# First argument is the vmid
vmid="$1"

# Second argument is the phase
phase="$2"

case "$phase" in
    'pre-start')
        # shellcheck disable=SC2016
        echo 'Setting AppArmor profile to `unconfined`'
        conffile="/etc/pve/lxc/$vmid.conf"
        if grep -qE '^lxc\.apparmor\.profile' "$conffile"; then
            sed -i -E 's/^lxc\.apparmor\.profile: .*$/lxc.apparmor.profile: unconfined/' "$conffile"
        else
            echo 'lxc.apparmor.profile: unconfined' >>"$conffile"
        fi
    ;;
    'post-start') ;;
    'pre-stop') ;;
    'post-stop') ;;
    *)
        echo "got unknown phase '$phase'" >&2
        exit 255
    ;;
esac
