#!/bin/bash
# Script to automatically fetch new contents from a branch, push them to container, and restart intern
# Last Modified on July 17th, 2025 by Maxwell Klema
# ----------------------------------------

RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🔄 Update Container Contents ${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

if [ "${DEPLOY_ON_START^^}" != "Y" ]; then
    echo "Skipping container update because there is nothing to update."
    exit 0
fi

source /var/lib/vz/snippets/helper-scripts/PVE_user_authentication.sh
source /var/lib/vz/snippets/helper-scripts/verify_container_ownership.sh

# Get Project Details

CONTAINER_NAME="${CONTAINER_NAME,,}"

if [ -z "$PROJECT_REPOSITORY" ]; then
    read -p "🚀 Paste the link to your project repository →  " PROJECT_REPOSITORY
fi

CheckRepository() {
    PROJECT_REPOSITORY_SHORTENED=${PROJECT_REPOSITORY#*github.com/}
    PROJECT_REPOSITORY_SHORTENED=${PROJECT_REPOSITORY_SHORTENED%.git}
    REPOSITORY_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://github.com/$RROJECT_REPOSITORY)
}


CheckRepository

while [ "$REPOSITORY_EXISTS" != "200" ]; do
    echo "⚠️ The repository link you provided, \"$PROJECT_REPOSITORY\" was not valid."
    read -p "🚀 Paste the link to your project repository →  " PROJECT_REPOSITORY
    CheckRepository
done

echo "✅ The repository link you provided, \"$PROJECT_REPOSITORY\", was valid."

# Get Project Branch

if [ "$PROJECT_BRANCH" == "" ]; then
    PROJECT_BRANCH="main"
fi

REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/$PROJECT_REPOSITORY_SHORTENED/branches/$PROJECT_BRANCH)

REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" $PROJECT_REPOSITORY/tree/$PROJECT_BRANCH)
while [ "$REPOSITORY_BRANCH_EXISTS" != "200" ]; do
    echo "⚠️ The branch you provided, \"$PROJECT_BRANCH\", does not exist on repository at \"$PROJECT_REPOSITORY\"."
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
    if [ "PROJECT_BRANCH" == "" ]; then
	PROJECT_BRANCH="main"
    fi
    REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" $PROJECT_REPOSITORY_SHORTENED/tree/$PROJECT_BRANCH)
done


# # Get Project Root Directroy

if [ "$PROJECT_ROOT" == "." ] || [ "$PROJECT_ROOT" == "" ]; then
    PROJECT_ROOT="/"
fi

VALID_PROJECT_ROOT=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateRepo \"$PROJECT_REPOSITORY\" \"$PROJECT_BRANCH\" \"$PROJECT_ROOT\"")

while [ "$VALID_PROJECT_ROOT" == "false" ]; do
    echo "⚠️ The root directory you provided, \"$PROJECT_ROOT\", does not exist on branch, \"$PROJECT_BRANCH\", on repository at \"$PROJECT_REPOSITORY\"."
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
    VALID_PROJECT_ROOT=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateRepo \"$PROJECT_REPOSITORY\" \"$PROJECT_BRANCH\" \"$PROJECT_ROOT\"")
done

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")
REPO_BASE_NAME_WITH_OWNER=$(echo "$PROJECT_REPOSITORY" | cut -d'/' -f4)

if [ "$PROJECT_ROOT" == "" ] || [ "$PROJECT_ROOT" == "/" ]; then
    PROJECT_ROOT="."
fi

# Install Services ====

echo "🛎️ Installing Services..."

# SERVICE_COMMANDS=$(ssh -o SendEnv="LINUX_DISTRIBUTION SERVICES CUSTOM_SERVICES REQUIRE_SERVICES" \
#     root@10.15.234.122 \
#    "/root/bin/deployment-scripts/gatherServices.sh true")

# echo "$SERVICE_COMMANDS" | while read -r line; do
#     pct exec $CONTAINER_ID -- bash -c "$line | true" > /dev/null 2>&1
# done

# Clone repository if needed ====

if (( "$CONTAINER_ID" % 2 == 0 )); then
    ssh root@10.15.0.5 "
        pct enter $CONTAINER_ID <<EOF
if [ ! -d '/root/$REPO_BASE_NAME' ]; then
cd /root && \
git clone $PROJECT_REPOSITORY && cd $REPO_BASE_NAME/ && git checkout $PROJECT_BRANCH > /dev/null
fi
EOF
    "
else
   pct enter $CONTAINER_ID <<EOF
if [ ! -d '/root/$REPO_BASE_NAME' ]; then
cd /root && \
git clone $PROJECT_REPOSITORY && cd $REPO_BASE_NAME/ && git checkout $PROJECT_BRANCH > /dev/null
fi
EOF
fi

# Update Container with New Contents from repository =====

startComponentPVE1() {

    RUNTIME="$1"
    BUILD_CMD="$2"
    START_CMD="$3"
    COMP_DIR="$4"
    INSTALL_CMD="$5"

    if [ "${RUNTIME^^}" == "NODEJS" ]; then
        pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 
        pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/ && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull" > /dev/null 2>&1
        pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $INSTALL_CMD && $BUILD_CMD" > /dev/null 2>&1
        pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2  
    elif [ "${RUNTIME^^}" == "PYTHON" ]; then
        pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 
        pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/ && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull" > /dev/null 2>&1
        pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate && $INSTALL_CMD && $BUILD_CMD" > /dev/null 2>&1
        pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2 
    fi
}

startComponentPVE2() {

    RUNTIME="$1"
    BUILD_CMD="$2"
    START_CMD="$3"
    COMP_DIR="$4"
    INSTALL_CMD="$5"

    if [ "${RUNTIME^^}" == "NODEJS" ]; then
        ssh root@10.15.0.5 "
            pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 &&
            pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/ && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull' > /dev/null 2>&1
            pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $INSTALL_CMD' && '$BUILD_CMD' > /dev/null 2>&1
            pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2
        " 
    elif [ "${RUNTIME^^}" == "PYTHON" ]; then
        ssh root@10.15.0.5 "
            pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 &&
            pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull' > /dev/null 2>&1
            pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate && $INSTALL_CMD' && '$BUILD_CMD' > /dev/null 2>&1
            pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2
        " 
    fi
}


if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
    for COMPONENT in $(echo "$START_COMMAND" | jq -r 'keys[]'); do
        START=$(echo "$START_COMMAND" | jq -r --arg k "$COMPONENT" '.[$k]')
        RUNTIME=$(echo "$RUNTIME_LANGUAGE" | jq -r --arg k "$COMPONENT" '.[$k]')
        BUILD=$(echo "$BUILD_COMMAND" | jq -r --arg k "$COMPONENT" '.[$k]')
        INSTALL=$(echo "$INSTALL_COMMAND" | jq -r --arg k "$COMPONENT" '.[$k]')
        if [ "$BUILD" == "null" ]; then
            BUILD=""
        fi

        if (( "$CONTAINER_ID" % 2 == 0 )); then
            startComponentPVE2 "$RUNTIME" "$BUILD" "$START" "$COMPONENT" "$INSTALL"
        else
            startComponentPVE1 "$RUNTIME" "$BUILD" "$START" "$COMPONENT" "$INSTALL"
        fi
    done
    if [ ! -z "$ROOT_START_COMMAND" ]; then
        if (( $CONTAINER_ID % 2 == 0 )); then
            ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && $ROOT_START_COMMAND'" 
        else
            pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && $ROOT_START_COMMAND" 
        fi
    fi
    # startComponent "$RUNTIME_LANGUAGE" "$BUILD_COMMAND" "$START_COMMAND" "."
else
    if (( $CONTAINER_ID % 2 == 0 )); then
        startComponentPVE2 "$RUNTIME_LANGUAGE" "$BUILD_COMMAND" "$START_COMMAND" "." "$INSTALL_COMMAND"
    else
        startComponentPVE1 "$RUNTIME_LANGUAGE" "$BUILD_COMMAND" "$START_COMMAND" "." "$INSTALL_COMMAND"
    fi
fi

# Update Log File

if (( "$CONTAINER_ID" % 2 == 0 )); then
    ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'echo \"[$(date)]\" >> /root/container-updates.log'"
else
    pct exec $CONTAINER_ID -- bash -c "echo \"[$(date)]\" >> /root/container-updates.log"
fi

# Create new template if on default branch =====

UPDATE_CONTAINER="true"
BUILD_COMMAND_B64=$(echo -n "$BUILD_COMMAND" | base64)
RUNTIME_LANGUAGE_B64=$(echo -n "$RUNTIME_LANGUAGE" | base64)
START_COMMAND_B64=$(echo -n "$START_COMMAND" | base64)

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
"$MULTI_COMPONENT"
"$START_COMMAND_B64"
"$BUILD_COMMAND_B64"
"$RUNTIME_LANGUAGE_B64"
"$GH_ACTION"
"$PROJECT_BRANCH"
"$GITHUB_PAT"
"$UPDATE_CONTAINER"
)

# Safely quote each argument for the shell
QUOTED_CMD=$(printf ' %q' "${CMD[@]}")

tmux new-session -d -s "$CONTAINER_NAME" "$QUOTED_CMD"
echo "✅ Container $CONTAINER_ID has been updated with new contents from branch \"$PROJECT_BRANCH\" on repository \"$PROJECT_REPOSITORY\"."
exit 0

