#!/bin/bash
# Helper script to determine if container needs to clone repository or simply update it
# Last Modified by Maxwell Klema on July 21st, 2025
# -------------------------------------------------

set +e
TYPE_RUNNER="true"
source /var/lib/vz/snippets/helper-scripts/PVE_user_authentication.sh
source /var/lib/vz/snippets/helper-scripts/verify_container_ownership.sh

STATUS=$?

if [ "$STATUS" != 0 ]; then
    exit 1;
fi

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")

# Check if repository folder is present.

if [ "$PVE1" == "true" ]; then
    if pct exec $CONTAINER_ID -- test -d /root/$REPO_BASE_NAME; then
        echo "Update"
        exit 2; # Update Repository
    else
        echo "Clone"
        exit 0; # Clone Repository
    fi
else
    if ssh 10.15.0.5 "pct exec $CONTAINER_ID -- test -d /root/$REPO_BASE_NAME"; then
        echo "Update"
        exit 2; # Update Repository
    else
        echo "Clone"
        exit 0; # Clone Repository
    fi
fi