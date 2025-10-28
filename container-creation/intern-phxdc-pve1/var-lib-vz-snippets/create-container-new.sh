#!/bin/bash
# Script to create the pct container, run register container, and migrate container accordingly.
# Last Modified by October 3rd, 2025 by Carter Myers
# -----------------------------------------------------

BOLD='\033[1m'
BLUE='\033[34m'
MAGENTA='\033[35m'
GREEN='\033[32m'
RESET='\033[0m'

cleanup() {
        echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo "⚠️  Script was abruptly exited. Running cleanup tasks."
        echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        pct_unlock $CTID_TEMPLATE
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
AI_CONTAINER="${22}"   # new argument from HTML form

echo "PROJECT ROOT: \"$PROJECT_ROOT\""
echo "AI_CONTAINER: \"$AI_CONTAINER\""

# === Determine target PVE host based on AI_CONTAINER ===
# PHOENIX -> 10.15.0.6 (existing AI host)
# FORTWAYNE -> 10.250.0.2 (new WireGuard-connected host)
# N -> local execution (no SSH proxy)
case "${AI_CONTAINER^^}" in
    PHOENIX)
        TARGET_PVE_HOST="10.15.0.6"
        ;;
    FORTWAYNE)
        TARGET_PVE_HOST="10.250.0.2"
        ;;
    N|"" )
        TARGET_PVE_HOST=""
        ;;
    *)
        echo "Invalid AI_CONTAINER value: $AI_CONTAINER"
        exit 1
        ;;
esac

# Helper: returns true if we're using a remote PVE host (PHOENIX or FORTWAYNE)
is_remote_pve() {
    [[ -n "$TARGET_PVE_HOST" ]]
}

# === Wrapper for pct exec (and optionally pct commands for remote PVE) ===
run_pct_exec() {
    local ctid="$1"
    shift
    if is_remote_pve; then
        ssh root@"$TARGET_PVE_HOST" "pct exec $ctid -- $*"
    else
        pct exec "$ctid" -- "$@"
    fi
}

run_pct() {
    # $@ = full pct command, e.g., clone, set, start, etc.
    if is_remote_pve; then
        ssh root@"$TARGET_PVE_HOST" "pct $*"
    else
        pct "$@"
    fi
}

run_pveum() {
    # Wrapper for pveum commands in remote case
    if is_remote_pve; then
        ssh root@"$TARGET_PVE_HOST" "pveum $*"
    else
        pveum "$@"
    fi
}

run_pvesh() {
    if is_remote_pve; then
        ssh root@"$TARGET_PVE_HOST" "pvesh $*"
    else
        pvesh "$@"
    fi
}

run_pct_push() {
    local ctid="$1"
    local src="$2"
    local dest="$3"
    if is_remote_pve; then
        ssh root@"$TARGET_PVE_HOST" "pct push $ctid $src $dest"
    else
        pct push "$ctid" "$src" "$dest"
    fi
}

# === Template Selection & Clone ===
if [[ "${AI_CONTAINER^^}" == "PHOENIX" ]]; then
    echo "⏳ Phoenix AI container requested. Using template CTID 163..."
    CTID_TEMPLATE="163"
    # Request cluster nextid from the target (remote if configured, else local via run_pvesh)
    CONTAINER_ID=$(run_pvesh get /cluster/nextid)

    echo "DEBUG: Cloning on TARGET_PVE_HOST=${TARGET_PVE_HOST:-local} CTID_TEMPLATE=${CTID_TEMPLATE} -> CONTAINER_ID=${CONTAINER_ID}"
    run_pct clone $CTID_TEMPLATE $CONTAINER_ID \
        --hostname $CONTAINER_NAME \
        --full true

    run_pct set $CONTAINER_ID \
        --tags "$PROXMOX_USERNAME" \
        --tags "$LINUX_DISTRO" \
        --tags "AI" \
        --onboot 1

    run_pct start $CONTAINER_ID
    run_pveum aclmod /vms/$CONTAINER_ID --user "$PROXMOX_USERNAME@pve" --role PVEVMUser

elif [[ "${AI_CONTAINER^^}" == "FORTWAYNE" ]]; then
    echo "⏳ Fort Wayne AI container requested. Using template CTID 103 on 10.250.0.2..."
    CTID_TEMPLATE="103"
    # allocate nextid directly on Fort Wayne
    CONTAINER_ID=$(ssh root@10.250.0.2 pvesh get /cluster/nextid)
    CONTAINER_ID=$((CONTAINER_ID + 20000))

    echo "DEBUG: Cloning on Fort Wayne (10.250.0.2) CTID_TEMPLATE=${CTID_TEMPLATE} -> CONTAINER_ID=${CONTAINER_ID}"
    ssh root@10.250.0.2 pct clone $CTID_TEMPLATE $CONTAINER_ID \
        --hostname $CONTAINER_NAME \
        --full true

    ssh root@10.250.0.2 pct set $CONTAINER_ID \
        --tags "$PROXMOX_USERNAME" \
        --tags "$LINUX_DISTRO" \
        --tags "AI" \
        --onboot 1

    ssh root@10.250.0.2 pct start $CONTAINER_ID
    ssh root@10.250.0.2 pveum aclmod /vms/$CONTAINER_ID --user "$PROXMOX_USERNAME@pve" --role PVEVMUser

else
    REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")
    REPO_BASE_NAME_WITH_OWNER=$(echo "$PROJECT_REPOSITORY" | cut -d'/' -f4)

    TEMPLATE_NAME="template-$REPO_BASE_NAME-$REPO_BASE_NAME_WITH_OWNER"
    # Search local and other known PVE (keeps original approach; will find local or remote templates depending on your environment)
    CTID_TEMPLATE=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$TEMPLATE_NAME" '$3 == name {print $1}')

    case "${LINUX_DISTRO^^}" in
      DEBIAN) PACKAGE_MANAGER="apt-get" ;;
      ROCKY)  PACKAGE_MANAGER="dnf" ;;
    esac

    if [ -z "$CTID_TEMPLATE" ]; then
      case "${LINUX_DISTRO^^}" in
        DEBIAN) CTID_TEMPLATE="160" ;;
        ROCKY)  CTID_TEMPLATE="138" ;;
      esac
    fi

    # For non-AI containers, allocate next ID locally and clone once here
    CONTAINER_ID=$(pvesh get /cluster/nextid)

    echo "⏳ Cloning Container (non-AI)... CTID_TEMPLATE=${CTID_TEMPLATE} -> CONTAINER_ID=${CONTAINER_ID}"
    run_pct clone $CTID_TEMPLATE $CONTAINER_ID \
        --hostname $CONTAINER_NAME \
        --full true

    echo "⏳ Setting Container Properties..."
    run_pct set $CONTAINER_ID \
        --tags "$PROXMOX_USERNAME" \
        --tags "$LINUX_DISTRO" \
        --tags "LDAP" \
        --onboot 1

    run_pct start $CONTAINER_ID
    run_pveum aclmod /vms/$CONTAINER_ID --user "$PROXMOX_USERNAME@pve" --role PVEVMUser
fi

# === Post-Provisioning (pct exec wrapped) ===
if [ -f "/var/lib/vz/snippets/container-public-keys/$PUB_FILE" ]; then
        echo "⏳ Appending Public Key..."
        run_pct_exec $CONTAINER_ID touch ~/.ssh/authorized_keys > /dev/null 2>&1
        # Use a here-doc to reliably feed the pubkey to the remote pct exec
        if is_remote_pve; then
            # copy key file to remote PVE host temporarily then pct push it in case pct exec over ssh doesn't accept stdin redirection
            scp "/var/lib/vz/snippets/container-public-keys/$PUB_FILE" root@"$TARGET_PVE_HOST":/tmp/"$PUB_FILE" > /dev/null 2>&1 || true
            ssh root@"$TARGET_PVE_HOST" "pct push $CONTAINER_ID /tmp/$PUB_FILE /root/.ssh/authorized_keys >/dev/null 2>&1 || (pct exec $CONTAINER_ID -- bash -lc 'cat > ~/.ssh/authorized_keys' < /tmp/$PUB_FILE)"
            ssh root@"$TARGET_PVE_HOST" "rm -f /tmp/$PUB_FILE" >/dev/null 2>&1 || true
        else
            run_pct_exec $CONTAINER_ID bash -c "cat > ~/.ssh/authorized_keys" < /var/lib/vz/snippets/container-public-keys/$PUB_FILE > /dev/null 2>&1
            rm -rf /var/lib/vz/snippets/container-public-keys/$PUB_FILE > /dev/null 2>&1
        fi
fi

ROOT_PSWD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)
run_pct_exec $CONTAINER_ID bash -c "echo root:$ROOT_PSWD | chpasswd" > /dev/null 2>&1

CONTAINER_IP=""
attempts=0
max_attempts=10

while [[ -z "$CONTAINER_IP" && $attempts -lt $max_attempts ]]; do
    CONTAINER_IP=$(run_pct_exec "$CONTAINER_ID" hostname -I | awk '{print $1}')
    [[ -z "$CONTAINER_IP" ]] && sleep 2 && ((attempts++))
done

if [[ -z "$CONTAINER_IP" ]]; then
    echo "❌ Timed out waiting for container to get an IP address."
    exit 1
fi

echo "⏳ Updatng container packages..."
if [[ "${LINUX_DISTRO^^}" == "ROCKY" ]]; then
    run_pct_exec $CONTAINER_ID bash -c "dnf upgrade -y"
else
    run_pct_exec $CONTAINER_ID bash -c "apt-get update && apt-get upgrade -y"
fi

echo "⏳ Configuring LDAP connection via SSSD..."
export AI_CONTAINER="$AI_CONTAINER"
source /var/lib/vz/snippets/helper-scripts/configureLDAP.sh

echo "⏳ Setting up Wazuh-Agent..."
source /var/lib/vz/snippets/Wazuh/register-agent.sh

if [ "${DEPLOY_ON_START^^}" == "Y" ]; then
        source /var/lib/vz/snippets/helper-scripts/deployOnStart.sh
        for file in \
                "/var/lib/vz/snippets/container-env-vars/$ENV_BASE_FOLDER" \
                "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE"
        do
                [ -f "$file" ] && rm -rf "$file" > /dev/null 2>&1
        done
fi

run_pct_exec $CONTAINER_ID bash -c "cd /root && touch container-updates.log"

echo "⏳ Running Container Provision Script..."
if [ -f "/var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE" ]; then
    /var/lib/vz/snippets/register-container.sh $CONTAINER_ID $HTTP_PORT /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE "$USERNAME_ONLY"
    rm -rf /var/lib/vz/snippets/container-port-maps/$PROTOCOL_FILE > /dev/null 2>&1
else
    /var/lib/vz/snippets/register-container.sh $CONTAINER_ID $HTTP_PORT "" "$PROXMOX_USERNAME"
fi

SSH_PORT=$(iptables -t nat -S PREROUTING | grep "to-destination $CONTAINER_IP:22" | awk -F'--dport ' '{print $2}' | awk '{print $1}' | head -n 1 || true)

echo "Adding container MOTD information..."
# port_map.json remains on central nginx host (10.15.20.69) — leave as-is unless you want to change that behavior
scp 10.15.20.69:/etc/nginx/port_map.json /tmp/port_map.json
CONTAINER_INFO=$(jq -r --arg hn "$CONTAINER_NAME" '.[$hn]' /tmp/port_map.json)

if [ "$CONTAINER_INFO" != "null" ]; then
    HOSTNAME="$CONTAINER_NAME"
    IP=$(echo "$CONTAINER_INFO" | jq -r '.ip')
    OWNER=$(echo "$CONTAINER_INFO" | jq -r '.user')
    OS_RELEASE=$(echo "$CONTAINER_INFO" | jq -r '.os_release')
    PORTS=$(echo "$CONTAINER_INFO" | jq -r '.ports | to_entries[] | "\(.key): \(.value)"' | paste -sd ", " -)
    PROTOCOLS=$(echo "$CONTAINER_INFO" | jq -r '.ports | keys | join(", ")')

    cat <<EOF > /tmp/container_motd
Container Information:
----------------------
Hostname      : $HOSTNAME
IP Address    : $IP
Ports         : $PORTS
Protocols     : $PROTOCOLS
Primary Owner : $OWNER
OS Release    : $OS_RELEASE
EOF
else
    echo "No container info found for $CONTAINER_NAME" > /tmp/container_motd
fi

run_pct_push $CONTAINER_ID /tmp/container_motd /etc/motd

echoContainerDetails

BUILD_COMMAND_B64=$(echo -n "$BUILD_COMMAND" | base64)
RUNTIME_LANGUAGE_B64=$(echo -n "$RUNTIME_LANGUAGE" | base64)
START_COMMAND_B64=$(echo -n "$START_COMMAND" | base64)

# Only run start_services when this is NOT an AI container (previously referenced undefined $AI)
if [[ "${AI_CONTAINER^^}" != "PHOENIX" && "${AI_CONTAINER^^}" != "FORTWAYNE" ]]; then
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
fi

QUOTED_CMD=$(printf ' %q' "${CMD[@]}")

# Create detached tmux session to run the (possibly long) service start process
if [[ -n "${CMD[*]}" ]]; then
    tmux new-session -d -s "$CONTAINER_NAME" "$QUOTED_CMD"
fi

exit 0
