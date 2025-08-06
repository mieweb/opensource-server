#!/bin/bash
# Script to create the pct container, run register container, and migrate container accordingly.
# Last Modified by June 30th, 2025 by Maxwell Klema

trap cleanup SIGINT SIGTERM SIGHUP

CONTAINER_NAME="$1"
HTTP_PORT="$2"
PROXMOX_USERNAME="$3"
PUB_FILE="$4"
PROTOCOL_FILE="$5"
NEXT_ID=$(pvesh get /cluster/nextid) #Get the next available LXC ID

# Generate random 20-character alphanumeric password for root
CONTAINER_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)

# Run cleanup commands in case script is interrupted

function cleanup()
{
	BOLD='\033[1m'
	RESET='\033[0m'

	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
	echo "⚠️  Script was abruptly exited. Running cleanup tasks."
	echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
	pct unlock 114
	if [ -f "/var/lib/vz/snippets/container-public-keys/$PUB_FILE" ]; then
		rm -rf /var/lib/vz/snippets/container-public-keys/$PUB_FILE
	fi
	if [ -f "/var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE" ]; then
		rm -rf /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE
	fi
	exit 1
}


# Create the Container Clone

echo "⏳ Cloning Container..."
pct clone 114 $NEXT_ID \
	--hostname $CONTAINER_NAME \
	--full true \

# Set Container Options

echo "⏳ Setting Container Properties.."
pct set $NEXT_ID \
	--tags "$PROXMOX_USERNAME" \
	--onboot 1 \

pct start $NEXT_ID
pveum aclmod /vms/$NEXT_ID --user "$PROXMOX_USERNAME@pve" --role PVEVMUser
#pct delete $NEXT_ID

# Get the Container IP Address and install some packages

echo "⏳ Waiting for DHCP to allocate IP address to container..."
sleep 10

CONTAINER_IP=$(pct exec $NEXT_ID -- hostname -I | awk '{print $1}')
pct exec $NEXT_ID -- apt-get upgrade
pct exec $NEXT_ID -- apt install -y sudo
pct exec $NEXT_ID -- apt install -y git
if [ -f "/var/lib/vz/snippets/container-public-keys/$PUB_FILE" ]; then
	pct exec $NEXT_ID -- touch ~/.ssh/authorized_keys
	pct exec $NEXT_ID -- bash -c "cat > ~/.ssh/authorized_keys"< /var/lib/vz/snippets/container-public-keys/$PUB_FILE
	rm -rf /var/lib/vz/snippets/container-public-keys/$PUB_FILE
fi

# Set password inside the container

pct exec $NEXT_ID -- bash -c "echo 'root:$CONTAINER_PASSWORD' | chpasswd"

# Run Contianer Provision Script to add container to port_map.json

if [ -f "/var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE" ]; then
	echo "CONTAINS PROTOCOL FILE"
	/var/lib/vz/snippets/register-container-test.sh $NEXT_ID $HTTP_PORT /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE
	rm -rf /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE
else
	/var/lib/vz/snippets/register-container-test.sh $NEXT_ID $HTTP_PORT
fi

SSH_PORT=$(iptables -t nat -S PREROUTING | grep "to-destination $CONTAINER_IP:22" | awk -F'--dport ' '{print $2}' | awk '{print $1}' | head -n 1 || true)

# Migrate to pve2 if Container ID is even

if (( $NEXT_ID % 2 == 0 )); then
       pct stop $NEXT_ID
       pct migrate $NEXT_ID intern-phxdc-pve2 --target-storage containers-pve2 --online
       ssh root@10.15.0.5 "pct start $NEXT_ID"
fi

# Echo Container Details

# Define friendly, high-contrast colors
BOLD='\033[1m'
BLUE='\033[34m'
MAGENTA='\033[35m'
GREEN='\033[32m'
RESET='\033[0m'

echo -e "📦  ${BLUE}Container ID        :${RESET} $NEXT_ID"
echo -e "🌐  ${MAGENTA}Internal IP         :${RESET} $CONTAINER_IP"
echo -e "🔗  ${GREEN}Domain Name         :${RESET} https://$CONTAINER_NAME.opensource.mieweb.org"
echo -e "🛠️  ${BLUE}SSH Access          :${RESET} ssh -p $SSH_PORT root@$CONTAINER_NAME.opensource.mieweb.org"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"