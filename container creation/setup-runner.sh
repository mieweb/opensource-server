#!/bin/bash
# A script for cloning a Distro template, installing, and starting a runner on it.
# Last Modified by Maxwell Klema on July 19th, 2025
# ------------------------------------------------

BOLD='\033[1m'
RESET='\033[0m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo "🧬 Cloning a Template and installing a Runner"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Validating Container Name =====

set +e

source /var/lib/vz/snippets/helper-scripts/PVE_user_authentication.sh #Authenticate User
source /var/lib/vz/snippets/helper-scripts/verify_container_ownership.sh #Ensure container does not exist.

CONTAINER_EXISTS=$?
if [ "$CONTAINER_EXISTS" != 1 ]; then
    exit $CONTAINER_EXISTS; # Container is not free to user, either someone else owns it or the user owns it.
fi
 
# Cloning Container Template and Setting it up =====

# Get correct template to clone and package manager 
if [ ${LINUX_DISTRIBUTION^^} == "DEBIAN" ]; then
    PACKAGE_MANAGER="apt"
    CTID_TEMPLATE="114"
elif [ "${LINUX_DISTRIBUTION^^}" == "ROCKY" ]; then
    PACKAGE_MANAGER="dnf"
    CTID_TEMPLATE="113"
fi

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")
REPO_BASE_NAME_WITH_OWNER=$(echo "$PROJECT_REPOSITORY" | cut -d'/' -f4)

NEXT_ID=$(pvesh get /cluster/nextid) #Get the next available LXC ID

# Create the Container Clone
echo "⏳ Cloning Container..."
pct clone $CTID_TEMPLATE $NEXT_ID \
	--hostname $CONTAINER_NAME \
	--full true > /dev/null 2>&1

# Set Container Options
echo "⏳ Setting Container Properties..."
pct set $NEXT_ID \
	--tags "$PROXMOX_USERNAME" \
	--onboot 1 > /dev/null 2>&1

pct start $NEXT_ID > /dev/null 2>&1
pveum aclmod /vms/$NEXT_ID --user "$PROXMOX_USERNAME@pve" --role PVEVMUser > /dev/null 2>&1

# Set password inside the container and install some pacakages
echo "📦 Updating Packages.."
pct exec $NEXT_ID -- bash -c "echo 'root:$CONTAINER_PASSWORD' | chpasswd" > /dev/null 2>&1
pct exec $NEXT_ID -- bash -c "$PACKAGE_MANAGER upgrade -y" > /dev/null > /dev/null 2>&1
pct exec $NEXT_ID -- bash -c "$PACKAGE_MANAGER install -y sudo tmux libicu perl-Digest-SHA git curl vim tar" > /dev/null 2>&1

# Setting Up Github Runner =====

# Get Temporary Token
echo "🪙  Getting Authentication Token..."
AUTH_TOKEN_RESPONSE=$(curl --location --request POST https://api.github.com/repos/$REPO_BASE_NAME_WITH_OWNER/$REPO_BASE_NAME/actions/runners/registration-token --header "Authorization: token $PAT")
TOKEN=$(echo "$AUTH_TOKEN_RESPONSE" | jq -r '.token')

pct enter $NEXT_ID <<EOF > /dev/null
mkdir actions-runner && cd actions-runner && \
curl -o actions-runner-linux-x64-2.326.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.326.0/actions-runner-linux-x64-2.326.0.tar.gz && \
echo "9c74af9b4352bbc99aecc7353b47bcdfcd1b2a0f6d15af54a99f54a0c14a1de8  actions-runner-linux-x64-2.326.0.tar.gz" | shasum -a 256 -c && \
tar xzf ./actions-runner-linux-x64-2.326.0.tar.gz && \
export RUNNER_ALLOW_RUNASROOT=1 && \
./config.sh --url $PROJECT_REPOSITORY --token $TOKEN --labels $CONTAINER_NAME
EOF

# Start Runner
pct exec $NEXT_ID -- bash -c "tmux new-session -d 'cd /actions-runner && export RUNNER_ALLOW_RUNASROOT=1 && ./run.sh'" > /dev/null 2>&1