#!/usr/bin/env bash
set -euo pipefail

CTID="${CTID:-100}"
BRIDGE="${BRIDGE:-vmbr0}"
MANAGER_TAG="${MANAGER_TAG:-latest}"

# Paths bind-mounted from this Proxmox container into the Manager LXC at the
# same path. Proxmox bind mounts are non-recursive (`mount -o bind`), so the
# node_modules named volumes that compose.yml layers over the repo are not
# visible through the repo's mount point; each needs its own. Proxmox mounts
# mp0, mp1, ... in index order, so the repo must come first and the nested
# node_modules mounts after it (see ensure_bind_mounts).
MANAGER_BIND_MOUNTS=(
    /opt/opensource-server
    /opt/opensource-server/create-a-container/node_modules
    /opt/opensource-server/agent/node_modules
)

# Succeeds if the container config has a bind mount point for $1 at the same
# path inside the container.
has_bind_mount() {
    pct config "${CTID}" | grep -qE "^mp[0-9]+: $1,mp=$1(,|$)"
}

# Succeeds if any path in MANAGER_BIND_MOUNTS is not yet mounted.
missing_bind_mounts() {
    local path
    for path in "${MANAGER_BIND_MOUNTS[@]}"; do
        has_bind_mount "${path}" || return 0
    done
    return 1
}

# Add each missing path in MANAGER_BIND_MOUNTS as a bind mount point. New mount
# points take the index after the highest one in use, so they always mount
# after (on top of) everything already configured — including the repo — and
# never reuse an index another mount point relies on. The container must be
# stopped: changing mount points while it runs triggers AppArmor/userns
# problems under the nested Proxmox-in-Docker.
ensure_bind_mounts() {
    local path next
    for path in "${MANAGER_BIND_MOUNTS[@]}"; do
        has_bind_mount "${path}" && continue
        next="$(pct config "${CTID}" \
            | sed -nE 's/^mp([0-9]+):.*/\1/p' \
            | sort -n | tail -n 1)"
        next=$(( ${next:--1} + 1 ))
        pct set "${CTID}" "--mp${next}=${path},mp=${path}"
    done
}


# Wait for pve-cluster.service to mount the Proxmox cluster filesystem
until [ -d /etc/pve/local ]; do
    sleep 0.5
done

# Decide whether the container is already fully provisioned. A bare existence
# check on the config file is not enough: an interrupted prior `pct create`
# (common under the nested Proxmox-in-Docker, e.g. a failed `--start=1`) leaves
# a partial config behind that is still holding the `create` lock. Treating that
# half-created container as "done" wedges every subsequent boot (`pct start`
# then fails with "missing 'arch'"). `pct create` releases the lock only on
# success, so its absence reliably marks a complete container; if the lock is
# still present we tear the remnants down and rebuild.
CONF="/etc/pve/lxc/${CTID}.conf"
if [ -f "${CONF}" ]; then
    if ! grep -q '^lock: create' "${CONF}"; then
        # Already provisioned. Bring its bind mounts up to date — e.g. a
        # container created before the node_modules volumes existed would
        # otherwise keep loading the host's node_modules — then leave it be.
        if missing_bind_mounts; then
            echo "Adding missing bind mounts to container ${CTID}."
            if pct status "${CTID}" | grep -q running; then
                pct shutdown "${CTID}"
            fi
            ensure_bind_mounts
            pct status "${CTID}" | grep -q running || pct start "${CTID}"
        fi
        exit 0
    fi
    echo "Container ${CTID} is partially created; tearing it down and recreating."
    pct unlock "${CTID}"
    pct destroy "${CTID}" --force
fi

# Ensure the specified network are available
if [ ! -d "/sys/class/net/${BRIDGE}" ]; then
    echo "Bridge ${BRIDGE} does not exist!"
    exit 1
fi

# Ensure the template for the specified tag is available
if [ ! -f "/var/lib/vz/template/cache/manager_${MANAGER_TAG}.tar" ]; then
    echo "Template local:vztmpl/manager_${MANAGER_TAG}.tar does not exist!"
    exit 1
fi

# Create the container, setting it to startup in emergency mode which will allow
# us to install our overrides into it's filesystem without the
# `container-creator-init.service` attempting to bootstrap the database before
# we're ready for it.
pct create 100 "local:vztmpl/manager_${MANAGER_TAG}.tar" \
    --features=nesting=1 \
    --hostname=manager \
    --memory=8192 \
    --net0="name=eth0,bridge=${BRIDGE},gw=10.254.0.1,ip=10.254.0.2/16" \
    --onboot=1 \
    --ostype=debian \
    --rootfs=local:50 \
    --entrypoint="/sbin/init systemd.unit=emergency.target" \
    --start=1

# We need to do some initial setup for the development environment before boot-
# strapping. First we make some self-signed SSL certs for the NGINX to use since
# it checks specific paths so we can't just rely on the snakeoil cert.
pct exec 100 -- openssl req \
    -x509 \
    -newkey ec \
    -pkeyopt ec_paramgen_curve:prime256v1 \
    -keyout /etc/ssl/private/localhost.key \
    -out /etc/ssl/certs/localhost.crt \
    -days 3650 \
    -noenc \
    -subj /CN=localhost

# Next we need to set up the systemd overrides so it will treat it as a develop-
# ment instance.
pct exec 100 -- mkdir -p /etc/systemd/system/container-creator.service.d
pct push 100 \
    /opt/opensource-server/images/proxmox-ve/99-container-creator-dev.conf \
    /etc/systemd/system/container-creator.service.d/99-container-creator-dev.conf

# Now we can set the entrypoint back to normal so it'll boot up to the
# default systemd target. We also use this opportunity to add the directory
# mounts (the repo plus its node_modules volumes; see MANAGER_BIND_MOUNTS).
# Doing it with the container online or during the create step causes all
# sorts of AppArmor and userns problems due to the nested Proxmox-in-Docker.
pct shutdown 100
ensure_bind_mounts

# Remove the temporary emergency entrypoint before the final start so the
# Manager CT boots to the default target with networking and services enabled.
pct set 100 --delete entrypoint

# Finally we start the container back up completing this service run.
pct start 100
