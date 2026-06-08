#!/usr/bin/env bash
set -euo pipefail

CTID="${CTID:-100}"
BRIDGE="${BRIDGE:-vmbr0}"
MANAGER_TAG="${MANAGER_TAG:-latest}"

# Leave the Manager CT unpinned by default. In nested Docker/WSL2,
# forcing a cores value can cause LXC to generate an invalid empty
# lxc.cgroup.cpuset.cpus line. Set MANAGER_CORES=4 to opt in.
MANAGER_CORES="${MANAGER_CORES:-}"
MANAGER_CORE_ARGS=()

if [ -n "$MANAGER_CORES" ]; then
    MANAGER_CORE_ARGS+=(--cores="${MANAGER_CORES}")
fi

# Wait for pve-cluster.service to mount the Proxmox cluster filesystem
until [ -d /etc/pve/local ]; do
    sleep 0.5
done

# Exit success if the specified container already exists
if [ -f "/etc/pve/lxc/${CTID}.conf" ]; then
    exit 0
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
    "${MANAGER_CORE_ARGS[@]}" \
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
# mount. Doing it with the container online or during the create step causes all
# sorts of AppArmor and userns problems due to the nested Proxmox-in-Docker.
pct shutdown 100
pct set 100 \
    --mp0=/opt/opensource-server,mp=/opt/opensource-server

# Remove the temporary emergency entrypoint before the final start so the
# Manager CT boots to the default target with networking and services enabled.
pct set 100 --delete entrypoint || true

# Finally we start the container back up completing this service run.
pct start 100
