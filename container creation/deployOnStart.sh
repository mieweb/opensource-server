#!/bin/bash
# Automation Script for attempting to automatically deploy projects and services on a container
# Last Modifided by Maxwell Klema on August 16th, 2025
# -----------------------------------------------------

echo "🚀  Attempting Automatic Deployment"
REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")

# Clone github repository from correct branch ====

echo "Repo base name: $REPO_BASE_NAME"

pct enter $CONTAINER_ID <<EOF
if [ ! -d '/root/$REPO_BASE_NAME' ]; then
cd /root && \
git clone $PROJECT_REPOSITORY > /dev/null 2>&1 && \
cd /root/$REPO_BASE_NAME && \
git checkout $PROJECT_BRANCH > /dev/null 2>&1
else
cd /root/$REPO_BASE_NAME && git fetch > /dev/null 2>&1 && git pull > /dev/null 2>&1 && \
git checkout $PROJECT_BRANCH > /dev/null 2>&1
fi
EOF

pct exec $CONTAINER_ID -- bash -c "chmod 700 ~/.bashrc" # enable full R/W/X permissions

# Copy over ENV variables ====

ENV_BASE_FOLDER="/var/lib/vz/snippets/container-env-vars/${ENV_BASE_FOLDER}"

if [ -d "$ENV_BASE_FOLDER" ]; then
    if [ "${MULTI_COMPONENTS^^}" == "Y" ]; then
        for FILE in $ENV_BASE_FOLDER/*; do
            FILE_BASENAME=$(basename "$FILE")
            FILE_NAME="${FILE_BASENAME%.*}"
            ENV_ROUTE=$(echo "$FILE_NAME" | tr '_' '/') # acts as the route to the correct folder to place .env file in.

            ENV_VARS=$(cat $ENV_BASE_FOLDER/$FILE_BASENAME)
            COMPONENT_PATH="/root/$REPO_BASE_NAME/$PROJECT_ROOT/$ENV_ROUTE"
            pct exec $CONTAINER_ID -- bash -c "if [ -f \"$COMPONENT_PATH/.env\" ]; then touch \"$COMPONENT_PATH/.env\"; fi; echo \"$ENV_VARS\" > \"$COMPONENT_PATH/.env\"" > /dev/null 2>&1
        done
    else
        ENV_FOLDER_BASE_NAME=$(basename "$ENV_BASE_FOLDER")
        ENV_VARS=$(cat $ENV_BASE_FOLDER/$ENV_FOLDER_BASE_NAME.txt || true)
        COMPONENT_PATH="/root/$REPO_BASE_NAME/$PROJECT_ROOT"
        pct exec $CONTAINER_ID -- bash -c "if [ -f \"$COMPONENT_PATH/.env\" ]; then touch \"$COMPONENT_PATH/.env\"; fi; echo \"$ENV_VARS\" > \"$COMPONENT_PATH/.env\"" > /dev/null 2>&1
    fi
fi

# Run Installation Commands ====

runInstallCommands() {

    RUNTIME="$1"
    COMP_DIR="$2"

    if [ "${RUNTIME^^}" == "NODEJS" ]; then
        pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && sudo $INSTALL_CMD" > /dev/null 2>&1
    elif [ "${RUNTIME^^}" == "PYTHON" ]; then
        pct enter $CONTAINER_ID <<EOF > /dev/null
cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && \
python3 -m venv venv && source venv/bin/activate && \
pip install --upgrade pip && \
$INSTALL_CMD
EOF
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
		pct exec $CONTAINER_ID -- bash -c "$line" > /dev/null 2>&1
	done < "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE"
fi
