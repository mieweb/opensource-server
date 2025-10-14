#!/bin/bash
# A script to collect the client's SSH fingerprint and pass that to the content creation container
# Last Modified  July 11, 2025 by Maxwell Klema
# ---------------------

CURRENT_TIME=$(date +"%B %d %T")

USER=$(whoami)
SSH_CLIENT_IP=$(echo $SSH_CLIENT | awk '{print $1}')
RECENT_LOG=$(journalctl --no-pager -r _COMM=sshd | grep "Accepted publickey for $USER from $SSH_CLIENT_IP" | head -n 1)
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

# Export environment variables

if [ "$USER" == "create-container"  ]; then
	VARS="AcceptEnv SSH_KEY_FP PUBLIC_KEY PROXMOX_USERNAME PROXMOX_PASSWORD CONTAINER_NAME CONTAINER_PASSWORD HTTP_PORT DEPLOY_ON_START PROJECT_REPOSITORY PROJECT_BRANCH PROJECT_ROOT REQUIRE_ENV_VARS CONTAINER_ENV_VARS INSTALL_COMMAND BUILD_COMMAND START_COMMAND RUNTIME_LANGUAGE SERVICES REQUIRE_SERVICES CUSTOM_SERVICES LINUX_DISTRIBUTION MULTI_COMPONENT ROOT_START_COMMAND GH_ACTION GITHUB_PAT SELF_HOSTED_RUNNER"

	for var in $VARS; do
		export "$var"="${!var}"
	done

	SEND_ENV=$(echo "$VARS" | tr '\n' ' ');
	SEND_ENV="SSH_KEY_FP $SEND_ENV"
	
	ssh -o SendEnv="$SEND_ENV" create-container@10.15.234.122
fi
