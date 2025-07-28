#!/bin/bash
# Script to check if a container exists
# Last Modified by Maxwell Klema on July 13th, 2025
# -----------------------------------------------------

RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🔎 Check Container Exists ${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

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
    if pct exec $CONTAINER_ID -- test -f /root/container-updates.log; then
        exit 2; # Update Repository
    else
        exit 0; # Clone Repository
    fi
else
    if ssh 10.15.0.5 "pct exec $CONTAINER_ID -- test -f /root/container-updates.log"; then
        exit 2; # Update Repository
    else
        exit 0; # Clone Repository
    fi
fi