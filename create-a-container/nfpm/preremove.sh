#!/bin/sh
# preremove for opensource-server: stop and disable the manager systemd units.
set -e

UNITS="container-creator.service job-runner.service container-creator-init.service"

# $1 is "remove"/"purge" (deb) or the remaining-version count (rpm: 0 on final
# removal). Only act on a real removal, not an upgrade.
case "${1:-}" in
    upgrade|1)
        # rpm upgrade ("1") / deb upgrade: leave units in place.
        exit 0
        ;;
esac

if [ -d /run/systemd/system ]; then
    for unit in $UNITS; do
        systemctl stop "$unit" >/dev/null 2>&1 || true
    done
fi

for unit in $UNITS; do
    systemctl disable "$unit" >/dev/null 2>&1 || true
done

exit 0
