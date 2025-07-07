#!/bin/bash
# Helper script to gather project details for automatic deployment
# Modified July 3rd, 2025 by Maxwell Klema
# ------------------------------------------

# Define color variables (works on both light and dark backgrounds)
RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

echo -e "${BOLD}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🌐 Let's Get Your Project Automatically Deployed ${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${RESET}"

# Get and validate project repository

if [ -z "$PROJECT_REPOSITORY" ]; then
    read -p "🚀 Paste the link to your project repository →  " PROJECT_REPOSITORY
fi


while ! git ls-remote --heads "$PROJECT_REPOSITORY" > /dev/null 2>&1 ; do
    echo "⚠️ The repository link you provided, \"$PROJECT_REPOSITORY\" was not valid."
    read -p "🚀 Paste the link to your project repository →  " PROJECT_REPOSITORY
done

# Get Repository Branch

if [ -z "$PROJECT_BRANCH" ]; then
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
fi

if [ "$PROJECT_BRANCH" == "" ]; then
    PROJECT_BRANCH="main"
fi

while ! git ls-remote --heads "$PROJECT_REPOSITORY" | grep -q "refs/heads/$PROJECT_BRANCH"; do
    echo "⚠️ The branch you provided, \"$PROJECT_BRANCH\", does not exist on repository at \"$PROJECT_REPOSITORY\"."
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
done

# Get Project Root Directory

if [ -z "$PROJECT_ROOT" ]; then
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
fi

if [ "$PROJECT_ROOT" == "" ]; then
    PROJECT_ROOT="/"
fi

VALID_PROJECT_ROOT=$(node js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$PROJECT_ROOT")

while [ "$VALID_PROJECT_ROOT" == "false" ]; do
    echo "⚠️ The root directory you provided, \"$PROJECT_ROOT\", does not exist on branch, \"$PROJECT_BRANCH\", on repository at \"$PROJECT_REPOSITORY\"."
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
    VALID_PROJECT_ROOT=$(node js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$PROJECT_ROOT")
done

# Get Environment Variables

gatherEnvVars(){

    read -p "🔑 Enter Environment Variable Key →  " ENV_VAR_KEY
    read -p "🔑 Enter Environment Variable Value →  " ENV_VAR_VALUE

    while [ "$ENV_VAR_KEY" == "" ] || [ "$ENV_VAR_VALUE" == "" ]; do
        echo "⚠️  Key or value cannot be empty. Try again."
        read -p "🔑 Enter Environment Variable Key →  " ENV_VAR_KEY
        read -p "🔑 Enter Environment Variable Value →  " ENV_VAR_VALUE
    done

    echo "$ENV_VAR_KEY=$ENV_VAR_VALUE" >> $TEMP_ENV_FILE_PATH

    read -p "🔑 Do you want to enter another Environment Variable? (y/n) →  " ENTER_ANOTHER_ENV
}

if [ -z "$REQUIRE_ENV_VARS" ]; then
    read -p "🔑 Does your application require environment variables? (y/n) →  " REQUIRE_ENV_VARS
fi

while [ "${REQUIRE_ENV_VARS^^}" != "Y" ] && [ "${REQUIRE_ENV_VARS^^}" != "N" ] && [ "${REQUIRE_ENV_VARS^^}" != "" ]; do
    echo "⚠️ Invalid option. Please try again."
    read -p "🔑 Does your application require environment variables? (y/n) →  " REQUIRE_ENV_VARS
done

if [ "${REQUIRE_ENV_VARS^^}" == "Y" ]; then

    # generate random temp .env file
    RANDOM_NUM=$(shuf -i 100000-999999 -n 1)
    ENV_FILE="env_$RANDOM_NUM.txt"
    TEMP_ENV_FILE_PATH="/root/bin/env/$ENV_FILE"
    touch "$TEMP_ENV_FILE_PATH"

    if [ ! -z "$CONTAINER_ENV_VARS" ]; then
        echo "$CONTAINER_ENV_VARS " | jq -r 'to_entries[] | "\(.key)=\(.value)"' > "$TEMP_ENV_FILE_PATH" #k=v pairs
    else
        gatherEnvVars
        while [ "${ENTER_ANOTHER_ENV^^}" == "Y" ]; do
            gatherEnvVars
        done
    fi
fi






# Get Install Command
if [ -z "$INSTALL_COMMAND" ]; then
    read -p "📦 Enter the install command (e.g., 'npm install', 'pip install') →  " INSTALL_COMMAND
fi

# Get Build Command
if [ -z "$BUILD_COMMAND" ]; then
    read -p "🏗️  Enter the build command (leave blank if not needed) →  " BUILD_COMMAND
fi

# Get Output Directory
if [ -z "$OUTPUT_DIRECTORY" ]; then
    read -p "📂 Enter the output directory (e.g., 'dist', 'build', leave blank if not applicable) →  " OUTPUT_DIRECTORY
fi

# Get Start Command
if [ -z "$START_COMMAND" ]; then
    read -p "🚦 Enter the start command (e.g., 'npm start', 'python app.py') →  " START_COMMAND
fi

# Get Runtime Language
if [ -z "$RUNTIME_LANGUAGE" ]; then
    read -p "🖥️  Enter the runtime language (e.g., 'nodejs', 'python') →  " RUNTIME_LANGUAGE
fi

