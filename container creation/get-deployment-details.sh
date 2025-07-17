#!/bin/bash
# Helper script to gather project details for automatic deployment
# Modified July 17th, 2025 by Maxwell Klema
# ------------------------------------------

# Define color variables (works on both light and dark backgrounds)
RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🌐 Let's Get Your Project Automatically Deployed ${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Get and validate project repository ========

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

# Get Repository Branch ========

if [ -z "$PROJECT_BRANCH" ]; then
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
fi

if [ "$PROJECT_BRANCH" == "" ]; then
    PROJECT_BRANCH="main"
fi

REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" $PROJECT_REPOSITORY/tree/$PROJECT_BRANCH)
while [ "$REPOSITORY_BRANCH_EXISTS" != "200" ]; do
    echo "⚠️ The branch you provided, \"$PROJECT_BRANCH\", does not exist on repository at \"$PROJECT_REPOSITORY\"."
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
    if [ "PROJECT_BRANCH" == "" ]; then
	PROJECT_BRANCH="main"
    fi
    REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" $PROJECT_REPOSITORY_SHORTENED/tree/$PROJECT_BRANCH)
done

# Get Project Root Directory ========

if [ -z "$PROJECT_ROOT" ]; then
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
fi

VALID_PROJECT_ROOT=$(node /root/bin/js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$PROJECT_ROOT")

while [ "$VALID_PROJECT_ROOT" == "false" ]; do
    echo "⚠️ The root directory you provided, \"$PROJECT_ROOT\", does not exist on branch, \"$PROJECT_BRANCH\", on repository at \"$PROJECT_REPOSITORY\"."
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
    VALID_PROJECT_ROOT=$(node /root/bin/js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$PROJECT_ROOT")
done

# Remove forward slash
if [[ "$PROJECT_ROOT" == "/*" ]]; then
    PROJECT_ROOT="${PROJECT_ROOT:1}"
fi

# Check if the App has multiple components (backend, frontend, multiple servers, etc.) ========

if [ -z "$MULTI_COMPONENT" ]; then
    read -p "🔗 Does your app consist of multiple components that run independently, i.e. seperate frontend and backend (y/n) →  " MULTI_COMPONENT
fi

while [ "${MULTI_COMPONENT^^}" != "Y" ] && [ "${MULTI_COMPONENT^^}" != "N" ] && [ "${MULTI_COMPONENT^^}" != "" ]; do
    echo "⚠️  Invalid option. Please try again."
    read -p "🔗 Does your app consist of multiple components that run independently, i.e. seperate frontend and backend (y/n) →  " MULTI_COMPONENT
done

# Gather Deployment Commands ========

# Helper functions to gather and validate component directory
gatherComponentDir() {

    COMPONENT_PATH="$2"
    if [ -z "$COMPONENT_PATH" ]; then
        read -p "$1, relative to project root directory (To Continue, Press Enter) →  "  COMPONENT_PATH
    fi
    # Check that component path is valid
    VALID_COMPONENT_PATH=$(node /root/bin/js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$COMPONENT_PATH")
    while [ "$VALID_COMPONENT_PATH" == "false" ] && [ "$COMPONENT_PATH" != "" ]; do
        echo "⚠️ The component path you entered, \"$COMPONENT_PATH\", does not exist on branch, \"$PROJECT_BRANCH\", on repository at \"$PROJECT_REPOSITORY\"."
        if [ -z "$2" ]; then
            read -p "$1, relative to project root directory (To Continue, Press Enter) →  "  COMPONENT_PATH
            VALID_COMPONENT_PATH=$(node /root/bin/js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$COMPONENT_PATH")
        else
            exit 9
        fi
    done

    if [[ "$COMPONENT_PATH" == /* ]]; then
        COMPONENT_PATH="${COMPONENT_PATH:1}" # remove leading slash
    fi
}

UNIQUE_COMPONENTS=()

# Helper function to add a component to unique components if its not already present
addComponent() {
    COMPONENT="$1"
    for CURRENT in "${UNIQUE_COMPONENTS[@]}"; do
        if [ "${COMPONENT,,}" == "${CURRENT,,}" ]; then
            return 0
        fi
    done
    UNIQUE_COMPONENTS+=("$COMPONENT")
}

source /root/bin/deployment-scripts/gatherSetupCommands.sh # Function to gather build, install, and start commands

source /root/bin/deployment-scripts/gatherEnvVars.sh # Gather Environment Variables
gatherSetupCommands "BUILD" "🏗️  Enter the build command (leave blank if no build command) →  " # Gather Build Command(s)
gatherSetupCommands "INSTALL" "📦 Enter the install command (e.g., 'npm install') →  " # Gather Install Command(s)echo "$INSTALL_COMMAND"
gatherSetupCommands "START" "🚦 Enter the start command (e.g., 'npm start', 'python app.py') →  " # Gather Start Command(s)


if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
    if [ -z "$ROOT_START_COMMAND" ]; then
        read -p "📍 If your container requires a start command at the root directory, i.e. Docker run, enter it here (leave blank for no command) →  " ROOT_START_COMMAND
    fi
fi

# Get Runtime Language ========

source /root/bin/deployment-scripts/gatherRuntimeLangs.sh

# Get Services ========

SERVICE_MAP="/root/bin/services/service_map_$LINUX_DISTRIBUTION.json"
APPENDED_SERVICES=()

# Helper function to check if a user has added the same service twice
serviceExists() {
    SERVICE="$1"
    for CURRENT in "${APPENDED_SERVICES[@]}"; do
        if [ "${SERVICE,,}" == "${CURRENT,,}" ]; then
            return 0
        fi
    done
    return 1
}

processService() {
    local SERVICE="$1"
    local MODE="$2" # "batch" or "single"

    SERVICE_IN_MAP=$(jq -r --arg key "${SERVICE,,}" '.[$key] // empty' "$SERVICE_MAP")
    if serviceExists "$SERVICE"; then
        if [ "$MODE" = "batch" ]; then
            return 0 # skip to next in batch mode
        else
            echo "⚠️  You already added \"$SERVICE\" as a service. Please try again."
            return 0
        fi
    elif [ "${SERVICE^^}" != "C" ] && [ "${SERVICE^^}" != "" ] && [ -n "$SERVICE_IN_MAP" ]; then
        jq -r --arg key "${SERVICE,,}" '.[$key][]' "$SERVICE_MAP" >> "$TEMP_SERVICES_FILE_PATH"
        echo "sudo systemctl daemon-reload" >> "$TEMP_SERVICES_FILE_PATH"
        echo "✅ ${SERVICE^^} added to your container."
        APPENDED_SERVICES+=("${SERVICE^^}")
    elif [ "${SERVICE^^}" == "C" ]; then
        appendCustomService
    elif [ "${SERVICE^^}" != "" ]; then
        echo "⚠️  Service \"$SERVICE\" does not exist."
        [ "$MODE" = "batch" ] && exit 20
    fi
}

# Helper function to append a new service to a container
appendService() {
    if [ ! -z "$SERVICES" ]; then
        for SERVICE in $(echo "$SERVICES" | jq -r '.[]'); do
            processService "$SERVICE" "batch"
        done
    else
        read -p "➡️  Enter the name of a service to add to your container or type \"C\" to set up a custom service installation (Enter to exit) →  " SERVICE
        processService "$SERVICE" "single"
    fi
}

appendCustomService() {
    # If there is an env variable for custom services, iterate through each command and append it to temporary services file
    if [ ! -z "$CUSTOM_SERVICES" ]; then
        echo "$CUSTOM_SERVICES" | jq -c -r '.[]' | while read -r CUSTOM_SERVICE; do
            echo "$CUSTOM_SERVICE" | jq -c -r '.[]' | while read -r CUSTOM_SERVICE_COMMAND; do
                if [ ! -z "$CUSTOM_SERVICE_COMMAND" ]; then
                    echo "$CUSTOM_SERVICE_COMMAND" >> "$TEMP_SERVICES_FILE_PATH"
                else
                    echo "⚠️  Command cannot be empty."
                    exit 21;
                fi
            done
        done
        echo "✅ Custom Services appended."
    else
        echo "🛎️  Configuring Custom Service Installation. For each prompt, enter a command that is a part of the installation process for your service on Debian Bookworm. Do not forget to enable and start the service at the end. Once you have entered all of your commands, press enter to continue"
        COMMAND_NUM=1
        read -p "➡️  Enter Command $COMMAND_NUM: " CUSTOM_COMMAND

        echo "$CUSTOM_COMMAND" >> "$TEMP_SERVICES_FILE_PATH"

        while [ "${CUSTOM_COMMAND^^}" != "" ]; do
            ((COMMAND_NUM++))
            read -p "➡️  Enter Command $COMMAND_NUM: " CUSTOM_COMMAND
            echo "$CUSTOM_COMMAND" >> "$TEMP_SERVICES_FILE_PATH"
        done
    fi
}

# Helper function to see if a user wants to set up a custom service
setUpService() {
    read -p "🛎️  Do you wish to set up a custom service installation? (y/n) " SETUP_CUSTOM_SERVICE_INSTALLATION
    while [ "${REQUIRE_SERVICES^^}" != "Y" ] && [ "${REQUIRE_SERVICES^^}" != "N" ] && [ "${REQUIRE_SERVICES^^}" != "" ]; do
        echo "⚠️  Invalid option. Please try again."
        read -p "🛎️  Do you wish to set up a custom service installation? (y/n) " SETUP_CUSTOM_SERVICE_INSTALLATION
    done
}

if [ -z "$REQUIRE_SERVICES" ]; then
    read -p "🛎️  Does your application require special services (i.e. Docker, MongoDB, etc.) to run on the container? (y/n) →  " REQUIRE_SERVICES
fi

while [ "${REQUIRE_SERVICES^^}" != "Y" ] && [ "${REQUIRE_SERVICES^^}" != "N" ] && [ "${REQUIRE_SERVICES^^}" != "" ]; do
    echo "⚠️  Invalid option. Please try again."
    read -p "🛎️  Does your application require special services (i.e. Docker, MongoDB, etc.) to run on the container? (y/n) →  " REQUIRE_SERVICES
done

if [ "${REQUIRE_SERVICES^^}" == "Y" ]; then
    
    # Generate random (temporary) file to store install commands for needed services 
    RANDOM_NUM=$(shuf -i 100000-999999 -n 1)
    SERVICES_FILE="services_$RANDOM_NUM.txt"
    TEMP_SERVICES_FILE_PATH="/root/bin/services/$SERVICES_FILE"
    touch "$TEMP_SERVICES_FILE_PATH"

    appendService
    while [ "${SERVICE^^}" != "" ] || [ ! -z "$SERVICES" ]; do
        if [ -z "$SERVICES" ]; then
            appendService
        else
            if [ ! -z "$CUSTOM_SERVICES" ]; then # assumes both services and custom services passed as ENV vars
                appendCustomService
            else # custom services not passed as ENV var, so must prompt the user for their custom services
                setUpService
                while [ "${SETUP_CUSTOM_SERVICE_INSTALLATION^^}" == "Y" ]; do
                    appendCustomService
                    setUpService
                done
            fi
            break
        fi
    done
fi

echo -e "\n✅ Deployment Process Finished.\n"
