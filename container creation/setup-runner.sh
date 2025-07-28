#!/bin/bash
# A script for cloning a Distro template, installing, and starting a runner on it.
# Last Modified by Maxwell Klema on July 20th, 2025
# ------------------------------------------------

BOLD='\033[1m'
RESET='\033[0m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo "🧬 Cloning a Template and installing a Runner"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Validating Container Name =====

source /var/lib/vz/snippets/helper-scripts/PVE_user_authentication.sh #Authenticate User
source /var/lib/vz/snippets/helper-scripts/verify_container_ownership.sh #Ensure container does not exist.

CONTAINER_EXISTS=$?

if [ "$CONTAINER_EXISTS" != 1 ]; then
    exit $CONTAINER_EXISTS; # Container is not free to user, either someone else owns it or the user owns it.
fi
 
# Cloning Container Template and Setting it up =====

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")
REPO_BASE_NAME_WITH_OWNER=$(echo "$PROJECT_REPOSITORY" | cut -d'/' -f4)

TEMPLATE_NAME="template-$REPO_BASE_NAME-$REPO_BASE_NAME_WITH_OWNER"
CTID_TEMPLATE=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$TEMPLATE_NAME" '$3 == name {print $1}')

case "${LINUX_DISTRIBUTION^^}" in
  DEBIAN) PACKAGE_MANAGER="apt-get" ;;
  ROCKY)  PACKAGE_MANAGER="dnf" ;;
esac

# If no template ID was provided, assign a default based on distro

if [ -z "$CTID_TEMPLATE" ]; then
  case "${LINUX_DISTRIBUTION^^}" in
    DEBIAN) CTID_TEMPLATE="160" ;;
    ROCKY)  CTID_TEMPLATE="138" ;;
  esac
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

sleep 5
echo "⏳ DHCP Allocating IP Address..."
CONTAINER_IP=$(pct exec $NEXT_ID -- hostname -I | awk '{print $1}')

# Set password inside the container
pct exec $NEXT_ID -- bash -c "echo 'root:$CONTAINER_PASSWORD' | chpasswd" > /dev/null 2>&1

# Setting Up Github Runner =====

# Get Temporary Token
echo "🪙  Getting Authentication Token..."
AUTH_TOKEN_RESPONSE=$(curl --location --request POST https://api.github.com/repos/$REPO_BASE_NAME_WITH_OWNER/$REPO_BASE_NAME/actions/runners/registration-token --header "Authorization: token $GITHUB_PAT")
TOKEN=$(echo "$AUTH_TOKEN_RESPONSE" | jq -r '.token')

pct enter $NEXT_ID <<EOF > /dev/null
rm -rf /root/container-updates.log | true && \
cd /actions-runner && export RUNNER_ALLOW_RUNASROOT=1 && \
export runProcess=\$(ps aux | grep run.sh | awk '{print \$2}' | head -n 1) && kill -9 \$runProcess || true && \
rm -rf .runner .credentials && rm -rf _work/* /var/log/runner/* && \
export RUNNER_ALLOW_RUNASROOT=1 && \
./config.sh --url $PROJECT_REPOSITORY --token $TOKEN --labels $CONTAINER_NAME --name $CONTAINER_NAME
EOF

# Generate RSA Keys =====

echo "🔑 Generating RSA Key Pair..."
pct exec $NEXT_ID -- bash -c "ssh-keygen -t rsa -N '' -f /root/.ssh/id_rsa -q"
PUB_KEY=$(pct exec $NEXT_ID -- bash -c "cat /root/.ssh/id_rsa.pub")

# Place public key in all necessary authorized_keys files
echo "$PUB_KEY" >> /home/create-container/.ssh/authorized_keys
echo "$PUB_KEY" >> /home/update-container/.ssh/authorized_keys
echo "$PUB_KEY" >> /home/delete-container/.ssh/authorized_keys
echo "$PUB_KEY" >> /home/container-exists/.ssh/authorized_keys

ssh root@10.15.234.122 "echo \"$PUB_KEY\" >> /root/.ssh/authorized_keys"

echo "🔑 Creating Service File..."
pct exec $NEXT_ID -- bash -c "cat <<EOF > /etc/systemd/system/github-runner.service
[Unit]
Description=GitHub Actions Runner
After=network.target

[Service]
Type=simple
WorkingDirectory=/actions-runner
Environment=\"RUNNER_ALLOW_RUNASROOT=1\"
ExecStart=/actions-runner/run.sh
Restart=always

[Install]
WantedBy=multi-user.target
EOF"

pct exec $NEXT_ID -- systemctl daemon-reload
pct exec $NEXT_ID -- systemctl enable github-runner
pct exec $NEXT_ID -- systemctl start github-runner

exit 3
