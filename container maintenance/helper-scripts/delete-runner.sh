#!/bin/bash
# Remove Github Runner Associated with Container (and Container itself too)
# Last Modified by Maxwell Klema on July 22nd, 2025
# ------------------------------------------------

PROJECT_REPOSITORY="$1"
GITHUB_PAT="$2"
PROXMOX_USERNAME="$3"
PROXMOX_PASSWORD="$4"
CONTAINER_NAME="$5"

sleep 2

# Delete Container

CONTAINER_ID=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$CONTAINER_NAME" '$3 == name {print $1}')

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

source /usr/local/bin/prune_iptables.sh

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")
REPO_BASE_NAME_WITH_OWNER=$(echo "$PROJECT_REPOSITORY" | cut -d'/' -f4)

RUNNERS=$(curl --location https://api.github.com/repos/$REPO_BASE_NAME_WITH_OWNER/$REPO_BASE_NAME/actions/runners --header "Authorization: token $GITHUB_PAT")

while read -r RUNNER; do
    RUNNER_NAME=$(echo "$RUNNER" | jq -r '.name')
    if [ "$RUNNER_NAME" == "$CONTAINER_NAME" ]; then
        RUNNER_ID=$(echo "$RUNNER" | jq -r '.id')
        curl --location --request DELETE "https://api.github.com/repos/$REPO_BASE_NAME_WITH_OWNER/$REPO_BASE_NAME/actions/runners/$RUNNER_ID" \
        --header "Authorization: token $GITHUB_PAT"
    fi
done < <(echo "$RUNNERS" | jq -c '.runners[]')