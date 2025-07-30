#!/bin/bash
# Script ran by a virtual terminal session to start services and migrate a container
# Script is only ran on GH action workflows when runner disconnects
# Last Modified by Maxwell Klema on July 23rd, 2025
# ------------------------------------------------

set -x 
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
START_COMMAND=$(echo "${11}" | base64 -d)
BUILD_COMMAND=$(echo "${12}" | base64 -d)
RUNTIME_LANGUAGE=$(echo "${13}" | base64 -d)
GH_ACTION="${14}"
PROJECT_BRANCH="${15}"
GITHUB_PAT="${16}"
UPDATE_CONTAINER="${17}"
CONTAINER_NAME="${CONTAINER_NAME,,}"

sleep 3
pct stop $CONTAINER_ID > /dev/null 2>&1

echo "$START_COMMAND"
echo "$BUILD_COMMAND"
echo "$RUNTIME_LANGUAGE"

sleep 10


# Create template if on default branch ====
# source /var/lib/vz/snippets/helper-scripts/create-template.sh

if (( $CONTAINER_ID % 2 == 0 )); then

	if [ "$UPDATE_CONTAINER" != "true" ]; then
		pct migrate $CONTAINER_ID intern-phxdc-pve2 --target-storage containers-pve2 --online > /dev/null 2>&1
		sleep 40 # wait for migration to finish (fix this later)
	fi

	ssh root@10.15.0.5 "pct start $CONTAINER_ID"
	ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'chmod 700 ~/.bashrc'"  # enable full R/W/X permissions
	ssh root@10.15.0.5 "pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4"

	if [ "${GH_ACTION^^}" == "Y" ]; then
		ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- systemctl start github-runner"
	fi 

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

# PVE 1
else
	pct start $CONTAINER_ID | true
	if [ "${GH_ACTION^^}" == "Y" ]; then
		pct exec $CONTAINER_ID -- bash -c "systemctl start github-runner"
	fi 

	startComponent() {

		RUNTIME="$1"
		BUILD_CMD="$2"
		START_CMD="$3"
		COMP_DIR="$4"

		if [ "${RUNTIME^^}" == "NODEJS" ]; then
			if [ "$BUILD_CMD" == "" ]; then
				pct exec $CONTAINER_ID -- bash -c "export PATH=\$PATH:/usr/local/bin && pm2 start bash -- -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $START_CMD'" > /dev/null 2>&1
			else
				pct enter $CONTAINER_ID <<EOF > /dev/null
export PATH=\$PATH:/usr/local/bin && \
$BUILD_CMD || true && pm2 start bash -- -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $START_CMD'
EOF
			fi
		elif [ "${RUNTIME^^}" == "PYTHON" ]; then
			if [ "$BUILD_CMD" == "" ]; then
				pct exec $CONTAINER_ID -- script -q -c "tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate && $START_CMD'" > /dev/null 2>&1
			else
				pct exec $CONTAINER_ID -- script -q -c "tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate $BUILD_CMD && $START_CMD'" > /dev/null 2>&1
			fi
		fi
	}

	pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 > /dev/null #temporarily bump up container resources for computation hungry processes (e.g. meteor)
	if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
		for COMPONENT in $(echo "$START_COMMAND" | jq -r 'keys[]'); do
			START=$(echo "$START_COMMAND" | jq -r --arg k "$COMPONENT" '.[$k]')
			RUNTIME=$(echo "$RUNTIME_LANGUAGE" | jq -r --arg k "$COMPONENT" '.[$k]')
			BUILD=$(echo "$BUILD_COMMAND" | jq -r --arg k "$COMPONENT" '.[$k]')
			if [ "$BUILD" == "null" ]; then
				BUILD=""
			fi

			startComponent "$RUNTIME" "$BUILD" "$START" "$COMPONENT"
		done
		if [ ! -z "$ROOT_START_COMMAND" ]; then
			pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && $ROOT_START_COMMAND" > /dev/null 2>&1
		fi
	else
		startComponent "$RUNTIME_LANGUAGE" "$BUILD_COMMAND" "$START_COMMAND" "."
	fi
	pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2 > /dev/null
fi