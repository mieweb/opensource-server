#!/bin/bash
# Script ran by a virtual terminal session to start services and migrate a container
# Script is only ran on GH action workflows when runner disconnects
# Last Modified by Maxwell Klema on August 5th, 2025
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
START_COMMAND=$(echo "${11}" | base64 -d)
BUILD_COMMAND=$(echo "${12}" | base64 -d)
RUNTIME_LANGUAGE=$(echo "${13}" | base64 -d)
GH_ACTION="${14}"
PROJECT_BRANCH="${15}"
UPDATE_CONTAINER="${16}"
CONTAINER_NAME="${CONTAINER_NAME,,}"

# Helper function to normalize paths by removing duplicate slashes
normalize_path() {
    echo "$1" | sed 's#/\+#/#g'
}

if [ "${GH_ACTION^^}" == "Y" ]; then
	sleep 8 # Wait for Job to Complete
fi

if (( $CONTAINER_ID % 2 == 0 )) && [ "$UPDATE_CONTAINER" == "true" ]; then
	ssh root@10.15.0.5 "pct stop $CONTAINER_ID" > /dev/null 2>&1
else
	pct stop $CONTAINER_ID > /dev/null 2>&1
fi

# Create template if on default branch ====
source /var/lib/vz/snippets/helper-scripts/create-template.sh

if (( $CONTAINER_ID % 2 == 0 )); then

	if [ "$UPDATE_CONTAINER" != "true" ]; then
		pct migrate $CONTAINER_ID intern-phxdc-pve2 --target-storage containers-pve2 --online > /dev/null 2>&1
		sleep 5 # wait for migration to finish (fix this later)
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
        
        # Create normalized path
        WORK_DIR=$(normalize_path "/root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR")

        if [ -z "$BUILD_CMD" ]; then
            BUILD_CMD="true"
        fi

        if [ "${RUNTIME^^}" == "NODEJS" ]; then
            ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c \"mkdir -p /tmp && chmod 1777 /tmp && mkdir -p /tmp/tmux-0 && chmod 700 /tmp/tmux-0 && TMUX_TMPDIR=/tmp tmux new-session -d 'export HOME=/root export PATH=\\\$PATH:/usr/local/bin && cd $WORK_DIR && $BUILD_CMD && $START_CMD'\"" > /dev/null 2>&1
        elif [ "${RUNTIME^^}" == "PYTHON" ]; then
            ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c \"mkdir -p /tmp && chmod 1777 /tmp && mkdir -p /tmp/tmux-0 && chmod 700 /tmp/tmux-0 && TMUX_TMPDIR=/tmp tmux new-session -d 'export HOME=/root export PATH=\\\$PATH:/usr/local/bin && cd $WORK_DIR && source venv/bin/activate $BUILD_CMD && $START_CMD'\"" > /dev/null 2>&1
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
                ROOT_WORK_DIR=$(normalize_path "/root/$REPO_BASE_NAME/$PROJECT_ROOT")
                ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'cd $ROOT_WORK_DIR && $ROOT_START_COMMAND'" > /dev/null 2>&1
            fi
        else
            startProject "$RUNTIME_LANGUAGE" "$BUILD_COMMAND" "$START_COMMAND" "."
            if [ ! -z "$ROOT_START_COMMAND" ]; then
                ROOT_WORK_DIR=$(normalize_path "/root/$REPO_BASE_NAME/$PROJECT_ROOT")
                ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'cd $ROOT_WORK_DIR && $ROOT_START_COMMAND'" > /dev/null 2>&1
            fi
        fi
    fi

# PVE 1
else
	pct start $CONTAINER_ID || true
	sleep 5
	if [ "${GH_ACTION^^}" == "Y" ]; then
		pct exec $CONTAINER_ID -- bash -c "systemctl start github-runner"
	fi

	startComponent() {

        RUNTIME="$1"
        BUILD_CMD="$2"
        START_CMD="$3"
        COMP_DIR="$4"
        
        # Create normalized path
        WORK_DIR=$(normalize_path "/root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR")

        if [ -z "$BUILD_CMD" ]; then
            BUILD_CMD="true"
        fi

        if [ "${RUNTIME^^}" == "NODEJS" ]; then
            pct exec "$CONTAINER_ID" -- bash -c "mkdir -p /tmp && chmod 1777 /tmp && mkdir -p /tmp/tmux-0 && chmod 700 /tmp/tmux-0 && TMUX_TMPDIR=/tmp/tmux-0 tmux new-session -d \"export HOME=/root && export PATH=\$PATH:/usr/local/bin && cd $WORK_DIR && $BUILD_CMD && $START_CMD\""
        elif [ "${RUNTIME^^}" == "PYTHON" ]; then
            pct exec "$CONTAINER_ID" -- bash -c "mkdir -p /tmp && chmod 1777 /tmp && mkdir -p /tmp/tmux-0 && chmod 700 /tmp/tmux-0 && TMUX_TMPDIR=/tmp/tmux-0 tmux new-session -d \"export HOME=/root &&export PATH=\$PATH:/usr/local/bin && cd $WORK_DIR && source venv/bin/activate && $BUILD_CMD && $START_CMD\""
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
            ROOT_WORK_DIR=$(normalize_path "/root/$REPO_BASE_NAME/$PROJECT_ROOT")
            pct exec $CONTAINER_ID -- bash -c "cd $ROOT_WORK_DIR && $ROOT_START_COMMAND" > /dev/null 2>&1
        fi
    else
        startComponent "$RUNTIME_LANGUAGE" "$BUILD_COMMAND" "$START_COMMAND" "."
        if [ ! -z "$ROOT_START_COMMAND" ]; then
            ROOT_WORK_DIR=$(normalize_path "/root/$REPO_BASE_NAME/$PROJECT_ROOT")
            pct exec $CONTAINER_ID -- bash -c "cd $ROOT_WORK_DIR && $ROOT_START_COMMAND" > /dev/null 2>&1
        fi
    fi
fi
