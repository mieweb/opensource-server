#!/bin/bash
# Automation Script for attempting to automatically deploy projects and services on a container
# Last Modifided by Maxwell Klema on July 16th, 2025
# -----------------------------------------------------

echo "🚀  Attempting Automatic Deployment"

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")

# Clone github repository from correct branch ====

pct enter $NEXT_ID <<EOF
cd /root && \ 
git clone --branch $PROJECT_BRANCH --single-branch $PROJECT_REPOSITORY
EOF

pct exec $NEXT_ID -- bash -c "chmod 700 ~/.bashrc" # enable full R/W/X permissions

# Copy over ENV variables ====

ENV_BASE_FOLDER="/var/lib/vz/snippets/container-env-vars/${ENV_BASE_FOLDER}"

if [ "${MULTI_COMPONENTS^^}" == "Y" ]; then
    for FILE in $ENV_BASE_FOLDER/*; do
        FILE_BASENAME=$(basename "$FILE")
        FILE_NAME="${FILE_BASENAME%.*}"
        ENV_ROUTE=$(echo "$FILE_NAME" | tr '_' '/') # acts as the route to the correct folder to place .env file in.
        
        ENV_VARS=$(cat $ENV_BASE_FOLDER/$FILE_BASENAME)
        pct enter $NEXT_ID <<EOF
cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$ENV_ROUTE && echo "$ENV_VARS" > .env 
EOF
    done
else
    ENV_FOLDER_BASE_NAME=$(basename "$ENV_BASE_FOLDER")
    ENV_VARS=$(cat $ENV_BASE_FOLDER/$ENV_FOLDER_BASE_NAME.txt)
    pct enter $NEXT_ID <<EOF
cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && echo "$ENV_VARS" > .env 
EOF
fi

# Run Installation Commands ====

runInstallCommands() {

    RUNTIME="$1"
    COMP_DIR="$2"

    if [ "${RUNTIME^^}" == "NODEJS" ]; then
        if [ ${LINUX_DISTRO^^} == "DEBIAN" ]; then
            pct enter $NEXT_ID <<EOF > /dev/null
sudo $PACKAGE_MANAGER install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo $PACKAGE_MANAGER update -y && \
sudo $PACKAGE_MANAGER install -y nodejs && \
npm install -g pm2 && \
cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && sudo $INSTALL_CMD
EOF
        elif [ "${LINUX_DISTRO^^}" == "ROCKY" ]; then
            pct enter $NEXT_ID <<EOF > /dev/null
sudo $PACKAGE_MANAGER install -y curl
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo $PACKAGE_MANAGER update -y && \
sudo $PACKAGE_MANAGER install -y nodejs && \
npm install -g pm2 && \
cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && sudo $INSTALL_CMD
EOF
        fi
    elif [ "${RUNTIME^^}" == "PYTHON" ]; then
        if [ ${LINUX_DISTRO^^} == "DEBIAN" ]; then
           pct enter $NEXT_ID <<EOF > /dev/null
sudo apt install -y python3-venv python3-pip tmux && \
cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && \
python3 -m venv venv && source venv/bin/activate && \
pip install --upgrade pip && \
$INSTALL_CMD
EOF
        elif [ "${LINUX_DISTRO^^}" == "ROCKY" ]; then
            pct enter $NEXT_ID <<EOF > /dev/null
sudo $PACKAGE_MANAGER install -y python python3-pip tmux && \
cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && \
python3 -m venv venv && source venv/bin/activate && \
pip install --upgrade pip && \
$INSTALL_CMD
EOF
        fi  
    fi
}

if [ "${MULTI_COMPONENTS^^}" == "Y" ]; then
    for COMPONENT in $(echo "$RUNTIME_LANGUAGE" | jq -r 'keys[]'); do
        RUNTIME=$(echo "$RUNTIME_LANGUAGE" | jq -r --arg k "$COMPONENT" '.[$k]') #get runtime env
        INSTALL_CMD=$(echo "$INSTALL_COMMAND" | jq -r --arg k "$COMPONENT" '.[$k]') #get install command
        if [ "$INSTALL_CMD" != "null" ]; then
            runInstallCommands "$RUNTIME" "$COMPONENT"
        fi
    done
else
    INSTALL_CMD=$INSTALL_COMMAND
    runInstallCommands "$RUNTIME_LANGUAGE" "."
fi

# Install Services ====

if [ -f "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE" ]; then
	while read line; do
		pct exec $NEXT_ID -- bash -c "$line" > /dev/null 2>&1
	done < "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE"
fi

# Build and Start Processes ====

startComponent() {

    RUNTIME="$1"
    BUILD_CMD="$2"
    START_CMD="$3"
    COMP_DIR="$4"

    if [ "${RUNTIME^^}" == "NODEJS" ]; then
		if [ "$BUILD_CMD" == "" ]; then
			pct exec $NEXT_ID -- bash -c "export PATH=\$PATH:/usr/local/bin && pm2 start bash -- -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $START_CMD'" > /dev/null 2>&1
		else
			pct enter $NEXT_ID <<EOF > /dev/null
export PATH=\$PATH:/usr/local/bin && \
$BUILD_CMD && pm2 start bash -- -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $START_CMD'
EOF
		fi
	elif [ "${RUNTIME^^}" == "PYTHON" ]; then
		if [ "$BUILD_CMD" == "" ]; then
			pct exec $NEXT_ID -- script -q -c "tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate && $START_CMD'" > /dev/null 2>&1
		else
			pct exec $NEXT_ID -- script -q -c "tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate $BUILD_CMD && $START_CMD'" > /dev/null 2>&1
		fi
	fi
}

if (( $NEXT_ID % 2 == 1 )); then
    pct set $NEXT_ID --memory 4096 --swap 0 --cores 4 > /dev/null #temporarily bump up container resources for computation hungry processes (e.g. meteor)
    if [ "${MULTI_COMPONENTS^^}" == "Y" ]; then
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
            pct exec $NEXT_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && $ROOT_START_COMMAND" > /dev/null 2>&1
        fi
    else
        startComponent "$RUNTIME_LANGUAGE" "$BUILD_COMMAND" "$START_COMMAND" "."
    fi
    pct set $NEXT_ID --memory 2048 --swap 0 --cores 2 > /dev/null
fi
