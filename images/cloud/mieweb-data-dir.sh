#!/bin/sh
# Ensure /mnt/data/<name> exists and is owned by the service account.
# Runs as root (ExecStartPre=+). The #421 volume at /mnt/data is chowned to the
# container's root by the site agent, so the per-service subdirectory has to be
# created and handed to `mieweb` here.
#
# The site agent creates the volume root 0770 (closed by default), which the
# `mieweb` service account can't traverse. Treat /mnt/data like /var/lib: open
# the root, keep each service's own directory private (0750 mieweb).
set -eu
chmod 0755 /mnt/data
dir="/mnt/data/$1"
install -d -m 0750 -o mieweb -g mieweb "$dir"
