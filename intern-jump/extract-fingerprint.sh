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

export SSH_KEY_FP="$KEY_FINGERPRINT"
export PROXMOX_USERNAME="$PROXMOX_USERNAME"
export PROXMOX_PASSWORD="$PROXMOX_PASSWORD"
export CONTAINER_NAME="$CONTAINER_NAME"
export CONTAINER_PASSWORD="$CONTAINER_PASSWORD"
export PUBLIC_KEY="$PUBLIC_KEY"

ssh -o "SendEnv=SSH_KEY_FP PROXMOX_USERNAME PROXMOX_PASSWORD CONTAINER_NAME CONTAINER_PASSWORD PUBLIC_KEY" -A create-container@10.15.234.122