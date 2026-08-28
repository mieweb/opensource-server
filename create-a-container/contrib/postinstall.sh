#!/bin/sh
set -e

UNITS="container-creator.service job-runner.service"

# Nothing to do without systemctl (non-systemd container/chroot).
command -v systemctl >/dev/null 2>&1 || exit 0

# `systemctl enable` only creates static symlinks, so it works during an image
# build too
systemctl enable $UNITS

# daemon-reload and restart need a running systemd; skip them at build time.
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload
    systemctl restart $UNITS
fi

exit 0
