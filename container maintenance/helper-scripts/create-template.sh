#!/bin/bash
# Creates a template of a LXC container
# Last modified by Maxwell Klema on July 23rd, 2025.
# --------------------------------------------------

if [ "${DEPLOY_ON_START^^}" != "Y" ] || [ "${GH_ACTION^^}" != "Y" ]; then
    return 0
fi

DEFAULT_BRANCH=$(curl -s https://api.github.com/repos/$REPO_BASE_NAME_WITH_OWNER/$REPO_BASE_NAME | jq -r '.default_branch')

if [ "$DEFAULT_BRANCH" != "$PROJECT_BRANCH" ]; then
    return 0
fi

echo "📝 Creating Container Template..."

# Check if template already exists, and if it does, destroy it =====

TEMPLATE_NAME="template-$REPO_BASE_NAME-$REPO_BASE_NAME_WITH_OWNER"
TEMPLATE_CONTAINER_ID=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$TEMPLATE_NAME" '$3 == name {print $1}')

if [ ! -z "$TEMPLATE_CONTAINER_ID" ]; then
    pct destroy $TEMPLATE_CONTAINER_ID | true
fi

# Clone LXC container and convert it into a template =====

NEXT_ID=$(pvesh get /cluster/nextid)

if (( $CONTAINER_ID % 2 == 101 )); then
    ssh root@10.15.0.5 "
    pct clone $CONTAINER_ID $NEXT_ID \
        --hostname "$TEMPLATE_NAME" \
        --full true
    pct migrate $NEXT_ID intern-phxdc-pve1 --target-storage containers-pve1
    " > /dev/null 2>&1
else
    pct clone $CONTAINER_ID $NEXT_ID \
        --hostname "$TEMPLATE_NAME" \
        --full true
fi

AUTH_TOKEN_RESPONSE=$(curl --location --request POST https://api.github.com/repos/$REPO_BASE_NAME_WITH_OWNER/$REPO_BASE_NAME/actions/runners/registration-token --header "Authorization: token $GITHUB_PAT")
TOKEN=$(echo "$AUTH_TOKEN_RESPONSE" | jq -r '.token')

# Remove rsa keys ====
pct start $NEXT_ID
pct enter $NEXT_ID <<EOF
rm -rf /root/.ssh/id_rsa.pub && rm -rf /root/.ssh/id_rsa && \
rm -rf /root/container-updates.log
EOF

pct stop $NEXT_ID
pct set $NEXT_ID --tags "$PROXMOX_USERNAME"
pct template $NEXT_ID