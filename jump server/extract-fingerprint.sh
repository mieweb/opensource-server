#!/bin/bash
# A script to collect the client's SSH fingerprint and pass that to the content creation container
# Last Modified  June 24th, 2025 by Maxwell Klema
# ---------------------

CURRENT_TIME=$(date +"%B %d %T")

USER="create-container"
SSH_CLIENT_IP=$(echo $SSH_CLIENT | awk '{print $1}')
RECENT_LOG=$(journalctl _COMM=sshd | grep "Accepted publickey for $USER from $SSH_CLIENT_IP" | tail -1)
LOGGED_TIME=$(echo $RECENT_LOG | awk '{print $3}')

#check most recent logged time and current time are only max 2 seconds off since multiple users may log in from same IP over time

epoch1=$(date -d "today $CURRENT_TIME" +%s)
epoch2=$(date -d "today $LOGGED_TIME" +%s)
diff=$((epoch1 - epoch2))

KEY_FINGERPRINT=""

if [ "$diff" -ge 0 ] && [ "$diff" -le 2 ]; then
	KEY_FINGERPRINT=$(echo $RECENT_LOG | grep -o 'SHA256[^ ]*')
fi

# Export environment variables
export PUBLIC_KEY="$PUBLIC_KEY"
export PROXMOX_USERNAME="$PROXMOX_USERNAME"
export PROXMOX_PASSWORD="$PROXMOX_PASSWORD"
export CONTAINER_NAME="$CONTAINER_NAME"
export CONTAINER_PASSWORD="$CONTAINER_PASSWORD"
export HTTP_PORT="$HTTP_PORT"
export PROJECT_REPOSITORY="$PROJECT_REPOSITORY"
export PROJECT_BRANCH="$PROJECT_BRANCH"
export PROJECT_ROOT="$PROJECT_ROOT"
export REQUIRE_ENV_VARS="$REQUIRE_ENV_VARS"
export CONTAINER_ENV_VARS="$CONTAINER_ENV_VARS"
export INSTALL_COMMAND="$INSTALL_COMMAND"
export BUILD_COMMAND="$BUILD_COMMAND"
export START_COMMAND="$START_COMMAND"
export RUNTIME_LANGUAGE="$RUNTIME_LANGUAGE"
export SERVICES="$SERVICES"
export REQUIRE_SERVICES="$REQUIRE_SERVICES"
export CUSTOM_SERVICES="$CUSTOM_SERVICES"

# SSH with all SendEnv flags
ssh -o "SendEnv=PUBLIC_KEY PROXMOX_USERNAME PROXMOX_PASSWORD CONTAINER_NAME CONTAINER_PASSWORD HTTP_PORT PROJECT_REPOSITORY PROJECT_BRANCH PROJECT_ROOT REQUIRE_ENV_VARS CONTAINER_ENV_VARS INSTALL_COMMAND BUILD_COMMAND START_COMMAND RUNTIME_LANGUAGE SERVICES REQUIRE_SERVICES CUSTOM_SERVICES" -A create-container@10.15.234.122
