#!/bin/bash
# Script to create the pct container, run register container, and migrate container accordingly.
# Last Modified by July 22nd, 2025 by Maxwell Klema

# Run cleanup commands in case script is interrupted
function cleanup()
{
	BOLD='\033[1m'
	RESET='\033[0m'

	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
	echo "⚠️  Script was abruptly exited. Running cleanup tasks."
	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
	pct unlock $CTID_TEMPLATE
	if [ -f "/var/lib/vz/snippets/container-public-keys/$PUB_FILE" ]; then
		rm -rf /var/lib/vz/snippets/container-public-keys/$PUB_FILE
	fi
	if [ -f "/var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE" ]; then
		rm -rf /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE
	fi
	if [ -f "/var/lib/vz/snippets/container-env-vars/$ENV_BASE_FOLDER" ]; then
		rm -rf "/var/lib/vz/snippets/container-env-vars/$ENV_BASE_FOLDER"
	fi 
	if [ -f "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE" ]; then
		rm -rf "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE"
	fi

	exit 1
}

# Echo Container Details
function echoContainerDetails() {
	BOLD='\033[1m'
	BLUE='\033[34m'
	MAGENTA='\033[35m'
	GREEN='\033[32m'
	RESET='\033[0m'

	echo -e "📦  ${BLUE}Container ID        :${RESET} $CONTAINER_ID"
	echo -e "🌐  ${MAGENTA}Internal IP         :${RESET} $CONTAINER_IP"
	echo -e "🔗  ${GREEN}Domain Name         :${RESET} https://$CONTAINER_NAME.opensource.mieweb.org"
	echo -e "🛠️  ${BLUE}SSH Access          :${RESET} ssh -p $SSH_PORT root@$CONTAINER_NAME.opensource.mieweb.org"
	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

trap cleanup SIGINT SIGTERM SIGHUP

CONTAINER_NAME="${CONTAINER_NAME,,}"

CONTAINER_NAME="$1"
CONTAINER_PASSWORD="$2"
GH_ACTION="$3"
HTTP_PORT="$4"
PROXMOX_USERNAME="$5"
PUB_FILE="$6"
PROTOCOL_FILE="$7"

# Deployment ENVS
DEPLOY_ON_START="$8"
PROJECT_REPOSITORY="$9"
PROJECT_BRANCH="${10}"
PROJECT_ROOT="${11}"
INSTALL_COMMAND="${12}"
BUILD_COMMAND="${13}"
START_COMMAND="${14}"
RUNTIME_LANGUAGE="${15}"
ENV_BASE_FOLDER="${16}"
SERVICES_BASE_FILE="${17}"
LINUX_DISTRO="${18}"
MULTI_COMPONENTS="${19}"
ROOT_START_COMMAND="${20}"

if [ ${LINUX_DISTRO^^} == "DEBIAN" ]; then
    PACKAGE_MANAGER="apt-get"
    CTID_TEMPLATE="114"
elif [ "${LINUX_DISTRO^^}" == "ROCKY" ]; then
    PACKAGE_MANAGER="dnf"
    CTID_TEMPLATE="113"
fi

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")

if [ "${GH_ACTION^^}" != "Y" ]; then
	# Create the Container Clone

	CONTAINER_ID=$(pvesh get /cluster/nextid) #Get the next available LXC ID

	echo "⏳ Cloning Container..."
	pct clone $CTID_TEMPLATE $CONTAINER_ID \
		--hostname $CONTAINER_NAME \
		--full true > /dev/null 2>&1

	# Set Container Options

	echo "⏳ Setting Container Properties..."
	pct set $CONTAINER_ID \
		--tags "$PROXMOX_USERNAME" \
		--onboot 1 > /dev/null 2>&1

	pct start $CONTAINER_ID > /dev/null 2>&1
	pveum aclmod /vms/$CONTAINER_ID --user "$PROXMOX_USERNAME@pve" --role PVEVMUser > /dev/null 2>&1
	#pct delete $CONTAINER_ID

	# Get the Container IP Address and install some packages

	echo "⏳ Waiting for DHCP to allocate IP address to container..."
	sleep 10

	echo "⏳ Updating Packages.."

	pct exec $CONTAINER_ID -- bash -c "$PACKAGE_MANAGER upgrade -y" > /dev/null
	pct exec $CONTAINER_ID -- bash -c "$PACKAGE_MANAGER install -y sudo git curl vim" > /dev/null
	if [ -f "/var/lib/vz/snippets/container-public-keys/$PUB_FILE" ]; then
		pct exec $CONTAINER_ID -- touch ~/.ssh/authorized_keys > /dev/null 2>&1
		pct exec $CONTAINER_ID -- bash -c "cat > ~/.ssh/authorized_keys"< /var/lib/vz/snippets/container-public-keys/$PUB_FILE > /dev/null 2>&1
		rm -rf /var/lib/vz/snippets/container-public-keys/$PUB_FILE > /dev/null 2>&1
	fi

	# Set password inside the container

	pct exec $CONTAINER_ID -- bash -c "echo 'root:$CONTAINER_PASSWORD' | chpasswd" > /dev/null 2>&1
else
	CONTAINER_ID=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$CONTAINER_NAME" '$3 == name {print $1}')
fi

CONTAINER_IP=$(pct exec $CONTAINER_ID -- hostname -I | awk '{print $1}')

# Attempt to Automatically Deploy Project Inside Container

if [ "${DEPLOY_ON_START^^}" == "Y" ]; then
	source /var/lib/vz/snippets/helper-scripts/deployOnStart.sh

	#cleanup
	if [ -f "/var/lib/vz/snippets/container-env-vars/$ENV_BASE_FOLDER" ]; then
		rm -rf "/var/lib/vz/snippets/container-env-vars/$ENV_BASE_FOLDER" > /dev/null 2>&1
	fi 
	if [ -f "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE" ]; then
		rm -rf "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE" > /dev/null 2>&1
	fi
fi

# Run Contianer Provision Script to add container to port_map.json

if [ -f "/var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE" ]; then
	/var/lib/vz/snippets/register-container.sh $CONTAINER_ID $HTTP_PORT /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE
	rm -rf /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE > /dev/null 2>&1
else
	/var/lib/vz/snippets/register-container.sh $CONTAINER_ID $HTTP_PORT 
fi

SSH_PORT=$(iptables -t nat -S PREROUTING | grep "to-destination $CONTAINER_IP:22" | awk -F'--dport ' '{print $2}' | awk '{print $1}' | head -n 1 || true)

# Migrate to pve2 if Container ID is even and restart project ====

startProject() {

	RUNTIME="$1"
	BUILD_CMD="$2"
	START_CMD="$3"
	COMP_DIR="$4"

	if [ "${RUNTIME^^}" == "NODEJS" ]; then
		if [ "$BUILD_CMD" == "" ]; then
			ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'export PATH=\$PATH:/usr/local/bin && pm2 start bash -- -c \"cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $START_CMD\"'" > /dev/null 2>&1
		else
			ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'export PATH=\$PATH:/usr/local/bin && $BUILD_CMD && pm2 start bash -- -c \"cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $START_CMD\"'" > /dev/null 2>&1
		fi
	elif [ "${RUNTIME^^}" == "PYTHON" ]; then
		if [ "$BUILD_CMD" == "" ]; then
			ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- script -q -c \"tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate && $START_CMD'\"" > /dev/null 2>&1
		else
			ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- script -q -c \"tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate $BUILD_CMD && $START_CMD'\"" > /dev/null 2>&1
		fi
	fi

}

if (( $CONTAINER_ID % 2 == 0 )); then
	if [ "${GH_ACTION^^}" != "Y" ]; then
		pct stop $CONTAINER_ID > /dev/null 2>&1
		pct migrate $CONTAINER_ID intern-phxdc-pve2 --target-storage containers-pve2 --online > /dev/null 2>&1
		ssh root@10.15.0.5 "pct start $CONTAINER_ID" > /dev/null 2>&1
		ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'chmod 700 ~/.bashrc'" > /dev/null 2>&1 # enable full R/W/X permissions
		ssh root@10.15.0.5 "pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4"  > /dev/null 2>&1
		if [ "${DEPLOY_ON_START^^}" == "Y" ]; then
			if [ "${MULTI_COMPONENTS^^}" == "Y" ]; then
				for COMPONENT in $(echo "$START_COMMAND" | jq -r 'keys[]'); do
					START=$(echo "$START_COMMAND" | jq -r --arg k "$COMPONENT" '.[$k]')
					RUNTIME=$(echo "$RUNTIME_LANGUAGE" | jq -r --arg k "$COMPONENT" '.[$k]')
					BUILD=$(echo "$BUILD_COMMAND" | jq -r --arg k "$COMPONENT" '.[$k]')
					if [ "$BUILD" == "null" ]; then
						BUILD=""
					fi
					startProject "$RUNTIME" "$BUILD" "$START" "$COMPONENT"
				done
				if [ ! -z "$ROOT_START_COMMAND" ]; then
					ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && $ROOT_START_COMMAND'" > /dev/null 2>&1
				fi
			else
				startProject "$RUNTIME_LANGUAGE" "$BUILD_COMMAND" "$START_COMMAND" "."
			fi
		fi
		ssh root@10.15.0.5 "pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2" 
	else
		echoContainerDetails
		echo "NOTE: Your Container needs to Migrate. Wait ~2 minutes before trying to SSH or navigate to the URL"
		
		CMD=(
		bash /var/lib/vz/snippets/finish-migration.sh
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
		"$START_COMMAND"
		"$BUILD_COMMAND"
		"$RUNTIME_LANGUAGE"
		)

		# Safely quote each argument for the shell
		QUOTED_CMD=$(printf ' %q' "${CMD[@]}")

		tmux new-session -d -s finish_migration "$QUOTED_CMD"
	fi
fi


echoContainerDetails
