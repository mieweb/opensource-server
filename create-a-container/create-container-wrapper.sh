#!/bin/bash
# Wrapper for non-interactive container creation
# Reads all inputs from environment variables and validates them
# Exits with error messages if invalid/missing

set -euo pipefail

GH_ACTION="${GH_ACTION:-}"

RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

outputError() {
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}${MAGENTA}❌ Script Failed. Exiting... ${RESET}"
    echo -e "$1"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    exit 1
}

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}📦 MIE Container Creation Script (Wrapper)${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Required variables, fail if not set or empty
: "${PROXMOX_USERNAME:?Environment variable PROXMOX_USERNAME is required}"
: "${PROXMOX_PASSWORD:?Environment variable PROXMOX_PASSWORD is required}"
: "${CONTAINER_NAME:?Environment variable CONTAINER_NAME is required}"
: "${LINUX_DISTRIBUTION:?Environment variable LINUX_DISTRIBUTION is required}"
: "${HTTP_PORT:?Environment variable HTTP_PORT is required}"
: "${DEPLOY_ON_START:=n}"  # default to "n" if not set

# Convert container name and linux distribution to lowercase
CONTAINER_NAME="${CONTAINER_NAME,,}"
LINUX_DISTRIBUTION="${LINUX_DISTRIBUTION,,}"
DEPLOY_ON_START="${DEPLOY_ON_START,,}"

# Validate Proxmox credentials using your Node.js authenticateUser
USER_AUTHENTICATED=$(node /root/bin/js/runner.js authenticateUser "$PROXMOX_USERNAME" "$PROXMOX_PASSWORD")
if [ "$USER_AUTHENTICATED" != "true" ]; then
    outputError "Invalid Proxmox Credentials."
fi

echo "🎉 Proxmox user '$PROXMOX_USERNAME' authenticated."

# Validate container name: alphanumeric + dash only
if ! [[ "$CONTAINER_NAME" =~ ^[a-z0-9-]+$ ]]; then
    outputError "Invalid container name: Only lowercase letters, numbers, and dashes are allowed."
fi

# Check if hostname already exists remotely
HOST_NAME_EXISTS=$(ssh root@10.15.20.69 "node /etc/nginx/checkHostnameRunner.js checkHostnameExists ${CONTAINER_NAME}")
if [ "$HOST_NAME_EXISTS" == "true" ]; then
    outputError "Container hostname '$CONTAINER_NAME' already exists."
fi
echo "✅ Container name '$CONTAINER_NAME' is available."

# Validate Linux distribution choice
if [[ "$LINUX_DISTRIBUTION" != "debian" && "$LINUX_DISTRIBUTION" != "rocky" ]]; then
    outputError "Linux distribution must be 'debian' or 'rocky'."
fi

# Validate HTTP_PORT: integer between 80 and 60000
if ! [[ "$HTTP_PORT" =~ ^[0-9]+$ ]] || [ "$HTTP_PORT" -lt 80 ] || [ "$HTTP_PORT" -gt 60000 ]; then
    outputError "HTTP_PORT must be a number between 80 and 60000."
fi

echo "✅ HTTP port set to $HTTP_PORT."

# Public key optional
if [ -n "${PUBLIC_KEY-}" ]; then
    # Validate public key format (simple check)
    if echo "$PUBLIC_KEY" | ssh-keygen -l -f - &>/dev/null; then
        AUTHORIZED_KEYS="/root/.ssh/authorized_keys"
        echo "$PUBLIC_KEY" > "$AUTHORIZED_KEYS"
        systemctl restart ssh
        echo "$PUBLIC_KEY" > "/root/bin/ssh/temp_pubs/key_$(shuf -i 100000-999999 -n1).pub"
        sudo /root/bin/ssh/publicKeyAppendJumpHost.sh "$PUBLIC_KEY"
        echo "🔐 Public key added."
    else
        outputError "Invalid PUBLIC_KEY format."
    fi
else
    echo "ℹ️ No public key provided."
fi

# Protocol list handling (optional)
PROTOCOL_BASE_FILE="protocol_list_$(shuf -i 100000-999999 -n 1).txt"
PROTOCOL_FILE="/root/bin/protocols/$PROTOCOL_BASE_FILE"
touch "$PROTOCOL_FILE"

# --- Logic for named protocols from a list (existing) ---
if [[ "${USE_OTHER_PROTOCOLS-}" == "y" || "${USE_OTHER_PROTOCOLS-}" == "Y" ]]; then
    if [ -z "${OTHER_PROTOCOLS_LIST-}" ]; then
        outputError "USE_OTHER_PROTOCOLS is yes but OTHER_PROTOCOLS_LIST is empty."
    fi
    IFS=',' read -ra PROTOCOLS <<< "$OTHER_PROTOCOLS_LIST"
    for PROTOCOL_NAME in "${PROTOCOLS[@]}"; do
        PROTOCOL_NAME=$(echo "$PROTOCOL_NAME" | tr '[:lower:]' '[:upper:]')
        FOUND=0
        while read -r line; do
            PROTOCOL_ABBRV=$(echo "$line" | awk '{print $1}')
            if [[ "$PROTOCOL_ABBRV" == "$PROTOCOL_NAME" ]]; then
                echo "$line" >> "$PROTOCOL_FILE"
                echo " ^|^e Protocol $PROTOCOL_NAME added."
                FOUND=1
                break
            fi
        done < "/root/bin/protocols/master_protocol_list.txt"
        if [ "$FOUND" -eq 0 ]; then
            echo " ^}^l Protocol $PROTOCOL_NAME not found, skipping."
        fi
    done
fi

# --- START: Added logic for single custom port ---
# Check if the OTHER_PORT variable is set and not empty
if [ -n "${OTHER_PORT-}" ]; then
    # Validate that it's an integer
    if [[ "$OTHER_PORT" =~ ^[0-9]+$ ]]; then
        echo "TCP $OTHER_PORT" >> "$PROTOCOL_FILE"
        echo "UDP $OTHER_PORT" >> "$PROTOCOL_FILE"
        echo " ^|^e Custom port $OTHER_PORT (TCP/UDP) added."
    else
        echo " ^}^l Invalid custom port specified: $OTHER_PORT. Must be an integer. Skipping."
    fi
fi

# Deploy on start must be y or n
if [[ "$DEPLOY_ON_START" != "y" && "$DEPLOY_ON_START" != "n" ]]; then
    outputError "DEPLOY_ON_START must be 'y' or 'n'."
fi

if [ "$DEPLOY_ON_START" == "y" ]; then
    source /root/bin/deploy-application.sh
fi

# Send files to hypervisor (public keys, protocols, env vars, services)
send_file_to_hypervisor() {
    local LOCAL_FILE="$1"
    local REMOTE_FOLDER="$2"
    if [ "$REMOTE_FOLDER" != "container-env-vars" ]; then
        if [ -s "$LOCAL_FILE" ]; then
            sftp root@10.15.0.4 <<EOF > /dev/null
put $LOCAL_FILE /var/lib/vz/snippets/$REMOTE_FOLDER/
EOF
        fi
    else
        if [ -d "$LOCAL_FILE" ]; then
            sftp root@10.15.0.4 <<EOF > /dev/null
put -r $LOCAL_FILE /var/lib/vz/snippets/$REMOTE_FOLDER/
EOF
        fi
    fi
}

# Example paths, set or export these in environment if used
send_file_to_hypervisor "/root/bin/ssh/temp_pubs/key_*.pub" "container-public-keys"
send_file_to_hypervisor "$PROTOCOL_FILE" "container-port-maps"
send_file_to_hypervisor "${ENV_FOLDER_PATH:-}" "container-env-vars"
send_file_to_hypervisor "${TEMP_SERVICES_FILE_PATH:-}" "container-services"

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🚀 Starting Container Creation...${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Safely get the basename of the temporary public key file.
KEY_BASENAME=""
# The 'find' command is safer than 'ls' for script usage.
KEY_FILE=$(find /root/bin/ssh/temp_pubs -type f -name "*.pub" | head -n1)

if [[ -n "$KEY_FILE" ]]; then
    KEY_BASENAME=$(basename "$KEY_FILE")
fi

# Run your create-container.sh remotely over SSH with corrected quoting and simplified variable
ssh -t root@10.15.0.4 "bash -c \"/var/lib/vz/snippets/create-container.sh \
    '$CONTAINER_NAME' \
    '$GH_ACTION' \
    '$HTTP_PORT' \
    '$PROXMOX_USERNAME' \
    '$KEY_BASENAME' \
    '$PROTOCOL_BASE_FILE' \
    '$DEPLOY_ON_START' \
    '${PROJECT_REPOSITORY:-}' \
    '${PROJECT_BRANCH:-}' \
    '${PROJECT_ROOT:-}' \
    '${INSTALL_COMMAND:-}' \
    '${BUILD_COMMAND:-}' \
    '${START_COMMAND:-}' \
    '${RUNTIME_LANGUAGE:-}' \
    '${ENV_FOLDER:-}' \
    '${SERVICES_FILE:-}' \
    '$LINUX_DISTRIBUTION' \
    '${MULTI_COMPONENT:-}' \
    '${ROOT_START_COMMAND:-}' \
\""

# Clean up temp files
rm -f "$PROTOCOL_FILE"
rm -f /root/bin/ssh/temp_pubs/key_*.pub
rm -f "${TEMP_SERVICES_FILE_PATH:-}"
rm -rf "${ENV_FOLDER_PATH:-}"

# Unset sensitive variables
unset PUBLIC_KEY

echo "✅ Container creation wrapper script finished successfully."