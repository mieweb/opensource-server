#!/bin/bash
# Script to create the pct container, run register container, and migrate container accordingly.
# Last Modified by August 5th, 2025 by Maxwell Klema
# -----------------------------------------------------

BOLD='\033[1m'
BLUE='\033[34m'
MAGENTA='\033[35m'
GREEN='\033[32m'
RESET='\033[0m'

# Run cleanup commands in case script is interrupted

cleanup()
{

	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
	echo "⚠️  Script was abruptly exited. Running cleanup tasks."
	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
	pct unlock $CTID_TEMPLATE
	for file in \
		"/var/lib/vz/snippets/container-public-keys/$PUB_FILE" \
		"/var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE" \
		"/var/lib/vz/snippets/container-env-vars/$ENV_BASE_FOLDER" \
		"/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE"
	do
		[ -f "$file" ] && rm -rf "$file"
	done
	exit 1
}

# Echo Container Details
echoContainerDetails() {
	echo -e "📦  ${BLUE}Container ID        :${RESET} $CONTAINER_ID"
	echo -e "🌐  ${MAGENTA}Internal IP         :${RESET} $CONTAINER_IP"
	echo -e "🔗  ${GREEN}Domain Name         :${RESET} https://$CONTAINER_NAME.opensource.mieweb.org"
	echo -e "🛠️  ${BLUE}SSH Access          :${RESET} ssh -p $SSH_PORT $PROXMOX_USERNAME@$CONTAINER_NAME.opensource.mieweb.org"
	echo -e "🔑  ${BLUE}Container Password  :${RESET} Your proxmox account password"
	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
	echo -e "${BOLD}${MAGENTA}NOTE: Additional background scripts are being ran in detached terminal sessions.${RESET}"
	echo -e "${BOLD}${MAGENTA}Wait up to two minutes for all processes to complete.${RESET}"
	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
	echo -e "${BOLD}${BLUE}Still not working? Contact Max K. at maxklema@gmail.com${RESET}"
	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

}

trap cleanup SIGINT SIGTERM SIGHUP

CONTAINER_NAME="${CONTAINER_NAME,,}"

CONTAINER_NAME="$1"
GH_ACTION="$2"
HTTP_PORT="$3"
PROXMOX_USERNAME="$4"
USERNAME_ONLY="${PROXMOX_USERNAME%@*}"
PUB_FILE="$5"
PROTOCOL_FILE="$6"

# Deployment ENVS
DEPLOY_ON_START="$7"
PROJECT_REPOSITORY="$8"
PROJECT_BRANCH="$9"
PROJECT_ROOT="${10}"
INSTALL_COMMAND=$(echo "${11}" | base64 -d)
BUILD_COMMAND=$(echo "${12}" | base64 -d)
START_COMMAND=$(echo "${13}" | base64 -d)
RUNTIME_LANGUAGE=$(echo "${14}" | base64 -d)
ENV_BASE_FOLDER="${15}"
SERVICES_BASE_FILE="${16}"
LINUX_DISTRO="${17}"
MULTI_COMPONENTS="${18}"
ROOT_START_COMMAND="${19}"
SELF_HOSTED_RUNNER="${20}"
VERSIONS_DICT=$(echo "${21}" | base64 -d)

echo "PROJECT ROOT: \"$PROJECT_ROOT\""

# Pick the correct template to clone =====

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")
REPO_BASE_NAME_WITH_OWNER=$(echo "$PROJECT_REPOSITORY" | cut -d'/' -f4)

TEMPLATE_NAME="template-$REPO_BASE_NAME-$REPO_BASE_NAME_WITH_OWNER"
CTID_TEMPLATE=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$TEMPLATE_NAME" '$3 == name {print $1}')

case "${LINUX_DISTRO^^}" in
  DEBIAN) PACKAGE_MANAGER="apt-get" ;;
  ROCKY)  PACKAGE_MANAGER="dnf" ;;
esac

# If no template ID was provided, assign a default based on distro

if [ -z "$CTID_TEMPLATE" ]; then
  case "${LINUX_DISTRO^^}" in
    DEBIAN) CTID_TEMPLATE="160" ;;
    ROCKY)  CTID_TEMPLATE="138" ;;
  esac
fi

# Create the Container Clone ====

if [ "${GH_ACTION^^}" != "Y" ] || [ "${SELF_HOSTED_RUNNER^^}" == "N" ]; then
	CONTAINER_ID=$(pvesh get /cluster/nextid) #Get the next available LXC ID

	echo "⏳ Cloning Container..."
	pct clone $CTID_TEMPLATE $CONTAINER_ID \
		--hostname $CONTAINER_NAME \
		--full true > /dev/null 2>&1

	# Set Container Options

	echo "⏳ Setting Container Properties..."
	pct set $CONTAINER_ID \
		--tags "$PROXMOX_USERNAME" \
		--tags "$LINUX_DISTRO" \
		--tags "LDAP" \
		--onboot 1 > /dev/null 2>&1

	pct start $CONTAINER_ID > /dev/null 2>&1
	pveum aclmod /vms/$CONTAINER_ID --user "$PROXMOX_USERNAME@pve" --role VMUser2 > /dev/null 2>&1

	# Get the Container IP Address and install some packages

	echo "⏳ Waiting for DHCP to allocate IP address to container..."
	sleep 5
else
	CONTAINER_ID=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$CONTAINER_NAME" '$3 == name {print $1}')
fi

if [ -f "/var/lib/vz/snippets/container-public-keys/$PUB_FILE" ]; then
	echo "⏳ Appending Public Key..."
	pct exec $CONTAINER_ID -- touch ~/.ssh/authorized_keys > /dev/null 2>&1
	pct exec $CONTAINER_ID -- bash -c "cat > ~/.ssh/authorized_keys"< /var/lib/vz/snippets/container-public-keys/$PUB_FILE > /dev/null 2>&1
	rm -rf /var/lib/vz/snippets/container-public-keys/$PUB_FILE > /dev/null 2>&1
fi

# Generate a random root password for the container
pct exec $CONTAINER_ID -- bash -c 'passwd -d root; passwd -l root' > /dev/null 2>&1

CONTAINER_IP=""
attempts=0
max_attempts=10

while [[ -z "$CONTAINER_IP" && $attempts -lt $max_attempts ]]; do
    CONTAINER_IP=$(pct exec "$CONTAINER_ID" -- hostname -I | awk '{print $1}')
    [[ -z "$CONTAINER_IP" ]] && sleep 2 && ((attempts++))
done

if [[ -z "$CONTAINER_IP" ]]; then
    echo "❌ Timed out waiting for container to get an IP address."
    exit 1
fi

# Set up SSSD to communicate with LDAP server ====
echo "⏳ Configuring LDAP connection via SSSD..."
source /var/lib/vz/snippets/helper-scripts/configureLDAP.sh

# Set up Wazuh-Agent on the container ====
echo "⏳ Setting up Wazuh-Agent..."
source /var/lib/vz/snippets/Wazuh/register-agent.sh

# Attempt to Automatically Deploy Project Inside Container

if [ "${DEPLOY_ON_START^^}" == "Y" ]; then
	source /var/lib/vz/snippets/helper-scripts/deployOnStart.sh

	#cleanup
	for file in \
		"/var/lib/vz/snippets/container-env-vars/$ENV_BASE_FOLDER" \
		"/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE"
	do
		[ -f "$file" ] && rm -rf "$file" > /dev/null 2>&1
	done
fi

# Create Log File ====

pct exec $CONTAINER_ID -- bash -c "cd /root && touch container-updates.log"

# Run Contianer Provision Script to add container to port_map.json
echo "⏳ Running Container Provision Script..."
if [ -f "/var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE" ]; then
    /var/lib/vz/snippets/register-container.sh $CONTAINER_ID $HTTP_PORT /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE "$USERNAME_ONLY"
    rm -rf /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE > /dev/null 2>&1
else
    /var/lib/vz/snippets/register-container.sh $CONTAINER_ID $HTTP_PORT "" "$PROXMOX_USERNAME"
fi

SSH_PORT=$(iptables -t nat -S PREROUTING | grep "to-destination $CONTAINER_IP:22" | awk -F'--dport ' '{print $2}' | awk '{print $1}' | head -n 1 || true)

# Output container details and start services if necessary =====

echoContainerDetails

BUILD_COMMAND_B64=$(echo -n "$BUILD_COMMAND" | base64)
RUNTIME_LANGUAGE_B64=$(echo -n "$RUNTIME_LANGUAGE" | base64)
START_COMMAND_B64=$(echo -n "$START_COMMAND" | base64)

CMD=(
bash /var/lib/vz/snippets/start_services.sh
"$CONTAINER_ID"
"$CONTAINER_NAME"
"$REPO_BASE_NAME"
"$REPO_BASE_NAME_WITH_OWNER"
"$SSH_PORT"
"$CONTAINER_IP"
"$PROJECT_ROOT"
"$ROOT_START_COMMAND"
"$DEPLOY_ON_START"
"$MULTI_COMPONENTS"
"$START_COMMAND_B64"
"$BUILD_COMMAND_B64"
"$RUNTIME_LANGUAGE_B64"
"$GH_ACTION"
"$PROJECT_BRANCH"
)

# Safely quote each argument for the shell
QUOTED_CMD=$(printf ' %q' "${CMD[@]}")

tmux new-session -d -s "$CONTAINER_NAME" "$QUOTED_CMD"
exit 0
