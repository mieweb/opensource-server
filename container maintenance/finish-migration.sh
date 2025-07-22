#!/bin/bash
# Script ran by a virtual terminal session to migrate a container
# Script is only ran on GH action workflows when runner disconnects due to migrations
# Last Modified by Maxwell Klema on July 22nd, 2025
# ------------------------------------------------

CONTAINER_ID="$1"
CONTAINER_NAME="$2"
REPO_BASE_NAME="$3"
REPO_BASE_NAME_WITH_OWNER="$4"
SSH_PORT="$5"
CONTAINER_IP="$6"
PROJECT_ROOT="$7"
ROOT_START_COMMAND="$8"
DEPLOY_ON_START="$9"
MULTI_COMPONENT="${10}"
START_COMMAND="${11}"
BUILD_COMMAND="${12}"
RUNTIME_LANGUAGE="${13}"

echo "$1 $2 $3 $4 $5 $6 $7 $8"
echo "Deploy on start: $9" >> "log.txt"
echo "Multi Component ${10}" >> "log.txt"
echo "Start command: ${11}" >> "log.txt"
echo "Build command: ${12}" >> "log.txt"
echo "Runtime language: ${13}" >> "log.txt"

CONTAINER_NAME="${CONTAINER_NAME,,}"

sleep 10

pct stop $CONTAINER_ID > /dev/null 2>&1
pct migrate $CONTAINER_ID intern-phxdc-pve2 --target-storage containers-pve2 --online > /dev/null 2>&1

sleep 40 # wait for migration to finish (fix this later)

ssh root@10.15.0.5 "pct start $CONTAINER_ID"
ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'chmod 700 ~/.bashrc'"  # enable full R/W/X permissions
ssh root@10.15.0.5 "pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4"
ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- systemctl start github-runner"
ssh root@10.15.0.5 "pct start $CONTAINER_ID" > /dev/null 2>&1
ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'chmod 700 ~/.bashrc'" > /dev/null 2>&1 # enable full R/W/X permissions
ssh root@10.15.0.5 "pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4"  > /dev/null 2>&1

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

if [ "${DEPLOY_ON_START^^}" == "Y" ]; then
    if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
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