#!/bin/sh
# Ensure /mnt/data/<name> exists and is owned by the service account.
# Runs as root (ExecStartPre=+). The #421 volume at /mnt/data is chowned to the
# container's root by the site agent, so the per-service subdirectory has to be
# created and handed to `mieweb` here.
set -eu
dir="/mnt/data/$1"
install -d -m 0750 -o mieweb -g mieweb "$dir"
