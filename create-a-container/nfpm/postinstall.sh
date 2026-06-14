#!/bin/sh
# postinstall for opensource-server: enable the manager systemd units.
set -e

UNITS="container-creator.service job-runner.service"

if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true
fi

# Enable on first install and upgrade so the services come up at boot. Use
# 'enable' (not '--now') so package installation never starts services in a
# build/chroot context; they start on the next boot or via the image.
for unit in $UNITS; do
    systemctl enable "$unit" >/dev/null 2>&1 || true
done

# If systemd is running, (re)start the long-running services so an upgrade
# picks up new code.
if [ -d /run/systemd/system ]; then
    systemctl restart $UNITS || true
fi

exit 0
