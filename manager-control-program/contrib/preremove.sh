#!/bin/sh
set -e

UNITS="opensource-mcp.service"

# $1 is "remove"/"purge" (deb) or the remaining-version count (rpm: 0 on final
# removal). Only act on a real removal, not an upgrade.
case "${1:-}" in
    upgrade|1)
        # rpm upgrade ("1") / deb upgrade: leave units in place.
        exit 0
        ;;
esac

# Nothing to do without systemctl
command -v systemctl >/dev/null 2>&1 || exit 0

# Stopping needs a running systemd; disabling (symlink removal) does not.
if [ -d /run/systemd/system ]; then
    systemctl stop $UNITS
fi
systemctl disable $UNITS

exit 0
