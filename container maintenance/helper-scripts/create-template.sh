#!/bin/bash
# Creates a template of a LXC container
# Last modified by Maxwell Klema on July 23rd, 2025.
# --------------------------------------------------

echo "📝 Creating Container Template..."

set -x 

if [ "${DEPLOY_ON_START^^}" != "Y" ] || [ "${GH_ACTION^^}" != "Y" ]; then
    return 0
fi

DEFAULT_BRANCH=$(curl -s https://api.github.com/repos/$REPO_BASE_NAME_WITH_OWNER/$REPO_BASE_NAME | jq -r '.default_branch')

if [ "$DEFAULT_BRANCH" != "$PROJECT_BRANCH" ]; then
    return 0
fi

# Check if template already exists, and if it does, destroy it =====

TEMPLATE_NAME="template-$REPO_BASE_NAME-$REPO_BASE_NAME_WITH_OWNER"
TEMPLATE_CONTAINER_ID=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$TEMPLATE_NAME" '$3 == name {print $1}')

if [ ! -z "$TEMPLATE_CONTAINER_ID" ]; then
    pct destroy $TEMPLATE_CONTAINER_ID
fi

# Clone LXC container and convert it into a template =====

NEXT_ID=$(pvesh get /cluster/nextid)
pct clone $CONTAINER_ID $NEXT_ID \
    --hostname "$TEMPLATE_NAME" \
    --full true

pct set $NEXT_ID --tags "$PROXMOX_USERNAME"
pct template $NEXT_ID