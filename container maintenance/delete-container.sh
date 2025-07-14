#!/bin/bash
# Script to delete a container permanently
# Last Modified by Maxwell Klema on July 13th, 2025
# -----------------------------------------------------

RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🗑️  Delete Container ${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

source /var/lib/vz/snippets/helper-scripts/PVE_user_authentication.sh
source /var/lib/vz/snippets/helper-scripts/verify_container_ownership.sh

# Delete Container

echo "🔄 Deleting container with name \"$CONTAINER_NAME\"..."

if (( $CONTAINER_ID % 2 == 0 )); then
    if ssh root@10.15.0.5 "pct status $CONTAINER_ID" | grep -q "status: running"; then
        ssh root@10.15.0.5 "pct stop $CONTAINER_ID && pct destroy $CONTAINER_ID" > /dev/null 2>&1
    else
        ssh root@10.15.0.5 "pct destroy $CONTAINER_ID" > /dev/null 2>&1
    fi
else
    if pct status "$CONTAINER_ID" | grep -q "status: running"; then
        pct stop "$CONTAINER_ID" && pct destroy "$CONTAINER_ID" > /dev/null 2>&1
    else
        pct destroy "$CONTAINER_ID" > /dev/null 2>&1
    fi
fi

echo "🧹  Running Cleanup Tasks..."
source /usr/local/bin/prune_iptables.sh

echo "✅ Container with name \"$CONTAINER_NAME\" has been permanently deleted."
exit 0 # Container Deleted Successfully