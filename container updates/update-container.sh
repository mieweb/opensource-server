#!/bin/bash
# Script to automatically fetch new contents from a branch, push them to container, and restart intern
# Last Modified on July 11th, 2025 by Maxwell Klema
# ----------------------------------------

# INSTALL_COMMAND BUILD_COMMAND START_COMMAND RUNTIME_LANGUAGE

RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🔄 Update Container Contents ${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Authenticate User (Only Valid Users can Create Containers)

if [ -z "$PROXMOX_USERNAME" ]; then
	read -p  "Enter Proxmox Username →  " PROXMOX_USERNAME
fi

if [ -z "$PROXMOX_PASSWORD" ]; then
	read -sp "Enter Proxmox Password →  " PROXMOX_PASSWORD
	echo ""
fi

USER_AUTHENTICATED=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateUser \"$PROXMOX_USERNAME\" \"$PROXMOX_PASSWORD\"")
RETRIES=3

while [ $USER_AUTHENTICATED == 'false' ]; do
	if [ $RETRIES -gt 0 ]; then
		echo "❌ Authentication Failed. Try Again"
		read -p  "Enter Proxmox Username →  " PROXMOX_USERNAME
		read -sp "Enter Proxmox Password →  " PROXMOX_PASSWORD
		echo ""

        USER_AUTHENTICATED=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateUser \"$PROXMOX_USERNAME\" \"$PROXMOX_PASSWORD\"")
		RETRIES=$(($RETRIES-1))
	else
		echo "Too many incorrect attempts. Exiting..."
		exit 2
	fi
done

echo "🎉 Your proxmox account, $PROXMOX_USERNAME@pve, has been authenticated"

# Get CTID from Container Name

if [ -z "$CONTAINER_NAME" ]; then
    read -p "Enter Container Name →  " CONTAINER_NAME
fi

CONTAINER_ID=$( { pct list; ssh root@10.15.0.5 'pct list'; }| awk -v name="$CONTAINER_NAME" '$3 == name {print $1}')

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ Container with name $CONTAINER_NAME does not exist on your account."
    exit 1
fi

if (( $CONTAINER_ID % 2 == 0 )); then
    CONTAINER_OWNERSHIP=$(ssh root@10.15.0.5 "pct config \"$CONTAINER_ID\" | grep "tags" | grep \"$PROXMOX_USERNAME\"")
else
    CONTAINER_OWNERSHIP=$(pct config "$CONTAINER_ID" | grep "tags" | grep "$PROXMOX_USERNAME")
fi

# echo "$CONTAINER_OWNERSHIP"

if [ -z "$CONTAINER_OWNERSHIP" ]; then
    echo "❌ You do not own the container with name $CONTAINER_NAME."
    exit 1
fi

# Get Project Details

if [ -z "$PROJECT_REPOSITORY" ]; then
    read -p "🚀 Paste the link to your project repository →  " PROJECT_REPOSITORY
fi

CheckRepository() {
    PROJECT_REPOSITORY_SHORTENED=${PROJECT_REPOSITORY#*github.com/}
    PROJECT_REPOSITORY_SHORTENED=${PROJECT_REPOSITORY_SHORTENED%.git}
    REPOSITORY_EXISTS=$(curl -H "Authorization: token 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" -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/$PROJECT_REPOSITORY_SHORTENED)
}

CheckRepository

while [ "$REPOSITORY_EXISTS" != "200" ]; do
    echo "⚠️ The repository link you provided, \"$PROJECT_REPOSITORY\" was not valid."
    read -p "🚀 Paste the link to your project repository →  " PROJECT_REPOSITORY
    CheckRepository
done

echo "✅ The repository link you provided, \"$PROJECT_REPOSITORY\", was valid."

# Get Project Branch

if [ -z "$PROJECT_BRANCH" ]; then
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
fi

if [ "$PROJECT_BRANCH" == "" ]; then
    PROJECT_BRANCH="main"
fi

REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/$PROJECT_REPOSITORY_SHORTENED/branches/$PROJECT_BRANCH)

while [ "$REPOSITORY_BRANCH_EXISTS" != "200" ]; do
    echo "⚠️ The branch you provided, \"$PROJECT_BRANCH\", does not exist on repository at \"$PROJECT_REPOSITORY\"."
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
    REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/$PROJECT_REPOSITORY_SHORTENED/branches/$PROJECT_BRANCH)
done


# Get Project Root Directroy

if [ -z "$PROJECT_ROOT" ]; then
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
fi

if [ "$PROJECT_ROOT" == "" ]; then
    PROJECT_ROOT="/"
fi

VALID_PROJECT_ROOT=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateRepo \"$PROJECT_REPOSITORY\" \"$PROJECT_BRANCH\" \"$PROJECT_ROOT\"")

while [ "$VALID_PROJECT_ROOT" == "false" ]; do
    echo "⚠️ The root directory you provided, \"$PROJECT_ROOT\", does not exist on branch, \"$PROJECT_BRANCH\", on repository at \"$PROJECT_REPOSITORY\"."
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
    VALID_PROJECT_ROOT=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateRepo \"$PROJECT_REPOSITORY\" \"$PROJECT_BRANCH\" \"$PROJECT_ROOT\"")
done

# Get Install Command ========

if [ -z "$INSTALL_COMMAND" ]; then
    read -p "📦 Enter the install command (e.g., 'npm install') →  " INSTALL_COMMAND
fi

# Get Build Command ========

if [ -z "$BUILD_COMMAND" ]; then
    read -p "🏗️  Enter the build command (leave blank if no build command) →  " BUILD_COMMAND
fi

# Get Start Command ========

if [ -z "$START_COMMAND" ]; then
    read -p "🚦 Enter the start command (e.g., 'npm start', 'python app.py') →  " START_COMMAND
fi

while [ "$START_COMMAND" == "" ]; do
    echo "⚠️  The start command cannot be blank. Please try again."
    read -p "🚦 Enter the start command (e.g., 'npm start') →  " START_COMMAND
done

# Get Runtime Language ========

if [ -z "$RUNTIME_LANGUAGE" ]; then
    read -p "🖥️  Enter the underlying runtime environment (e.g., 'nodejs', 'python') →  " RUNTIME_LANGUAGE
fi

while [ "${RUNTIME_LANGUAGE^^}" != "NODEJS" ] && [ "${RUNTIME_LANGUAGE^^}" != "PYTHON" ]; do
    echo "⚠️  Sorry, that runtime environment is not yet supported. Only \"nodejs\" and \"python\" are currently supported."
    read -p "🖥️  Enter the underlying runtime environment (e.g., 'nodejs', 'python') →  " RUNTIME_LANGUAGE
done

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")

# Update Container with New Contents from repository

if (( "$CONTAINER_ID" % 2 == 0 )); then
    if [ "${RUNTIME_LANGUAGE^^}" == "NODEJS" ]; then
        ssh root@10.15.0.5 "
            pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 &&
            pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull'
            pct exec $CONTAINER_ID -- bash -c '$INSTALL_COMMAND_COMMAND' && '$BUILD_COMMAND'
            pct exec $CONTAINER_ID -- bash -c 'export PATH=\$PATH:/usr/local/bin && cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && pm2 start bash -- -c \"$START_COMMAND\"'
            pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2
        "
    elif [ "${RUNTIME_LANGUAGE^^}" == "PYTHON" ]; then
        ssh root@10.15.0.5 "
            pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 &&
            pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull'
            pct exec $CONTAINER_ID -- bash -c '$INSTALL_COMMAND' && '$BUILD_COMMAND'
            pct exec $CONTAINER_ID -- script -q -c \"tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && source venv/bin/activate && $START_COMMAND'\" /dev/null
            pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2
        "
    fi
else
    if [ "${RUNTIME_LANGUAGE^^}" == "NODEJS" ]; then
        pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 &&
        pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull'
        pct exec $CONTAINER_ID -- bash -c '$INSTALL_COMMAND_COMMAND' && '$BUILD_COMMAND'
        pct exec $CONTAINER_ID -- bash -c 'export PATH=\$PATH:/usr/local/bin && cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && pm2 start bash -- -c \"$START_COMMAND\"'
        pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2
    elif [ "${RUNTIME_LANGUAGE^^}" == "PYTHON" ]; then
        pct set $CONTAINER_ID --memory 4096 --swap 0 --cores 4 &&
        pct exec $CONTAINER_ID -- bash -c 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && git fetch origin && git reset --hard origin/$PROJECT_BRANCH && git pull'
        pct exec $CONTAINER_ID -- bash -c '$INSTALL_COMMAND' && '$BUILD_COMMAND'
        pct exec $CONTAINER_ID -- script -q -c \"tmux new-session -d 'cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && source venv/bin/activate && $START_COMMAND'\" /dev/null
        pct set $CONTAINER_ID --memory 2048 --swap 0 --cores 2
    fi
fi

echo "✅ Container $CONTAINER_ID has been updated with new contents from branch \"$PROJECT_BRANCH\" on repository \"$PROJECT_REPOSITORY\"."