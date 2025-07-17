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

source /var/lib/vz/snippets/helper-scripts/PVE_user_authentication.sh
source /var/lib/vz/snippets/helper-scripts/verify_container_ownership.sh

# Get Project Details

if [ -z "$PROJECT_REPOSITORY" ]; then
    read -p "🚀 Paste the link to your project repository →  " PROJECT_REPOSITORY
fi

CheckRepository() {
    PROJECT_REPOSITORY_SHORTENED=${PROJECT_REPOSITORY#*github.com/}
    PROJECT_REPOSITORY_SHORTENED=${PROJECT_REPOSITORY_SHORTENED%.git}
    REPOSITORY_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/$PROJECT_REPOSITORY_SHORTENED)
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

while [ "$REPOSITORY_BRANCH_EXISTS" != "200" ]; do
    echo "⚠️ The branch you provided, \"$PROJECT_BRANCH\", does not exist on repository at \"$PROJECT_REPOSITORY\"."
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
    REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/$PROJECT_REPOSITORY_SHORTENED/branches/$PROJECT_BRANCH)
done


# # Get Project Root Directroy

if [ "$PROJECT_ROOT" == "" ]; then
    PROJECT_ROOT="/"
fi

VALID_PROJECT_ROOT=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateRepo \"$PROJECT_REPOSITORY\" \"$PROJECT_BRANCH\" \"$PROJECT_ROOT\"")

while [ "$VALID_PROJECT_ROOT" == "false" ]; do
    echo "⚠️ The root directory you provided, \"$PROJECT_ROOT\", does not exist on branch, \"$PROJECT_BRANCH\", on repository at \"$PROJECT_REPOSITORY\"."
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
    VALID_PROJECT_ROOT=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateRepo \"$PROJECT_REPOSITORY\" \"$PROJECT_BRANCH\" \"$PROJECT_ROOT\"")
done

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")

if [ "$PROJECT_ROOT" == "" ] || [ "$PROJECT_ROOT" == "/" ]; then
    PROJECT_ROOT="."
fi

# Update Container with New Contents from repository

startComponentPVE1() {

    RUNTIME="$1"
    BUILD_CMD="$2"
    START_CMD="$3"
    COMP_DIR="$4"
    INSTALL_CMD="$5"

    if [ "${RUNTIME^^}" == "NODEJS" ]; then
        pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 > /dev/null
        pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/ && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull" > /dev/null
        pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $INSTALL_CMD' && '$BUILD_CMD" > /dev/null
        pct exec $CONTAINER_ID -- bash -c "export PATH=\$PATH:/usr/local/bin && pm2 start bash -- -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $START_CMD'" > /dev/null
        pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2 > /dev/null
    elif [ "${RUNTIME^^}" == "PYTHON" ]; then
        pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 > /dev/null
        pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/ && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull" > /dev/null
        pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $INSTALL_CMD' && '$BUILD_CMD" > /dev/null
        pct exec $CONTAINER_ID -- script -q -c "tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate && $START_CMD'" > /dev/null
        pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2 > /dev/null
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
            pct exec $CONTAINER_ID -- bash -c 'export PATH=\$PATH:/usr/local/bin && pm2 start bash -- -c \"cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $START_CMD\"' > /dev/null 2>&1
            pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2
        " > /dev/null
    elif [ "${RUNTIME^^}" == "PYTHON" ]; then
        ssh root@10.15.0.5 "
            pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 &&
            pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull' > /dev/null 2>&1
            pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && $INSTALL_CMD' && '$BUILD_CMD' > /dev/null 2>&1
            pct exec $CONTAINER_ID -- script -q -c \"tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT/$COMP_DIR && source venv/bin/activate && $START_CMD'\" > /dev/null 2>&1
            pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2
        " > /dev/null
    fi
}

if (( "$CONTAINER_ID" % 2 == 0 )); then
    startComponentPVE2
else
    startComponentPVE1
fi

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
    if [ ! -z "$START_ON_ROOT" ]; then;
        if (( "$CONTAINER_ID" % 2 == 0 )); then
            ssh root@10.15.0.5 "pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && $ROOT_START_COMMAND'" > /dev/null 2>&1
        else
            pct exec $CONTAINER_ID -- bash -c "cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && $ROOT_START_COMMAND" > /dev/null 2>&1
        fi
    fi
    # startComponent "$RUNTIME_LANGUAGE" "$BUILD_COMMAND" "$START_COMMAND" "."
fi

echo "✅ Container $CONTAINER_ID has been updated with new contents from branch \"$PROJECT_BRANCH\" on repository \"$PROJECT_REPOSITORY\"."
exit 0