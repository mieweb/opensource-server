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

# Mail DB roles (issue #67): (re)create the read-only mail_dovecot /
# mail_postfix users + view grants. Skipped before first-boot DB init
# (container-creator-init.service runs it then) and on SQLite.
if [ -f /etc/default/container-creator ]; then
    bash /opt/opensource-server/create-a-container/bin/setup-mail-db-roles.sh || true
fi

exit 0
