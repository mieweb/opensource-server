#!/bin/bash
# Helper script to gather project details for automatic deployment
# Modified August 5th, 2025 by Maxwell Klema
# ------------------------------------------

# Define color variables (works on both light and dark backgrounds)
RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🌐 Let's Get Your Project Automatically Deployed ${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

writeLog "Starting deploy application script"

# Get and validate project repository ========

if [ -z "$PROJECT_REPOSITORY" ]; then
    read -p "🚀 Paste the link to your project repository →  " PROJECT_REPOSITORY
    writeLog "Prompted for project repository"
fi

CheckRepository() {
    PROJECT_REPOSITORY_SHORTENED=${PROJECT_REPOSITORY#*github.com/}
    PROJECT_REPOSITORY_SHORTENED=${PROJECT_REPOSITORY_SHORTENED%.git}
    REPOSITORY_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://github.com/$PROJECT_REPOSITORY_SHORTENED)
    writeLog "Checking repository existence for $PROJECT_REPOSITORY_SHORTENED"
}

CheckRepository

while [ "$REPOSITORY_EXISTS" != "200" ]; do
    if [ "${GH_ACTION^^}" == "Y" ]; then
        outputError "Invalid Repository Link. Make sure your repository is private."
        writeLog "Invalid repository link entered: $PROJECT_REPOSITORY (GH_ACTION mode)"
        exit 10
    fi
    echo "⚠️ The repository link you provided, \"$PROJECT_REPOSITORY\" was not valid."
    writeLog "Invalid repository link entered: $PROJECT_REPOSITORY"
    read -p "🚀 Paste the link to your project repository →  " PROJECT_REPOSITORY
    CheckRepository
done

writeLog "Repository validated: $PROJECT_REPOSITORY"

# Get Repository Branch ========

if [ -z "$PROJECT_BRANCH" ]; then
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
    writeLog "Prompted for project branch"
fi

if [ -z "$PROJECT_BRANCH" ]; then
    PROJECT_BRANCH="main"
    writeLog "Using default branch: main"
fi

REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://github.com/$PROJECT_REPOSITORY_SHORTENED/tree/$PROJECT_BRANCH)
writeLog "Checking branch existence for $PROJECT_BRANCH"

while [ "$REPOSITORY_BRANCH_EXISTS" != "200" ]; do
    if [ "${GH_ACTION^^}" == "Y" ]; then
        outputError "Invalid Branch. Make sure your branch exists on the repository."
        writeLog "Invalid branch entered: $PROJECT_BRANCH (GH_ACTION mode)"
        exit 11
    fi
    echo "⚠️ The branch you provided, \"$PROJECT_BRANCH\", does not exist on repository at \"$PROJECT_REPOSITORY\"."
    writeLog "Invalid branch entered: $PROJECT_BRANCH"
    read -p "🪾  Enter the project branch to deploy from (leave blank for \"main\") → " PROJECT_BRANCH
    if [ -z "$PROJECT_BRANCH" ]; then
        PROJECT_BRANCH="main"
    fi
    REPOSITORY_BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://github.com/$PROJECT_REPOSITORY_SHORTENED/tree/$PROJECT_BRANCH)
done

writeLog "Branch validated: $PROJECT_BRANCH"

# Get Project Root Directory ========

if [ -z "$PROJECT_ROOT" ]; then
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
    writeLog "Prompted for project root directory"
fi

VALID_PROJECT_ROOT=$(node /root/bin/js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$PROJECT_ROOT")
writeLog "Validating project root directory: $PROJECT_ROOT"

while [ "$VALID_PROJECT_ROOT" == "false" ]; do
    if [ "${GH_ACTION^^}" == "Y" ]; then
        outputError "Invalid Project Root Directory. Make sure your directory exists on the repository."
        writeLog "Invalid project root directory entered: $PROJECT_ROOT (GH_ACTION mode)"
        exit 12
    fi
    echo "⚠️ The root directory you provided, \"$PROJECT_ROOT\", does not exist on branch, \"$PROJECT_BRANCH\", on repository at \"$PROJECT_REPOSITORY\"."
    writeLog "Invalid project root directory entered: $PROJECT_ROOT"
    read -p "📁 Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  " PROJECT_ROOT
    VALID_PROJECT_ROOT=$(node /root/bin/js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$PROJECT_ROOT")
done

writeLog "Project root directory validated: $PROJECT_ROOT"

# Remove forward slash
if [[ "$PROJECT_ROOT" == "/*" ]]; then
    PROJECT_ROOT="${PROJECT_ROOT:1}"
fi

# Check if the App has multiple components (backend, frontend, multiple servers, etc.) ========

if [ -z "$MULTI_COMPONENT" ]; then
    read -p "🔗 Does your app consist of multiple components that run independently, i.e. seperate frontend and backend (y/n) →  " MULTI_COMPONENT
    writeLog "Prompted for multi-component option"
fi

while [ "${MULTI_COMPONENT^^}" != "Y" ] && [ "${MULTI_COMPONENT^^}" != "N" ] && [ "${MULTI_COMPONENT^^}" != "" ]; do
    if [ "${GH_ACTION^^}" == "Y" ]; then
        outputError "Invalid option for MULTI_COMPONENT. It must be 'y' or 'n'. Please try again."
        writeLog "Invalid multi-component option entered: $MULTI_COMPONENT (GH_ACTION mode)"
        exit 13
    fi
    echo "⚠️  Invalid option. Please try again."
    writeLog "Invalid multi-component option entered: $MULTI_COMPONENT"
    read -p "🔗 Does your app consist of multiple components that run independently, i.e. seperate frontend and backend (y/n) →  " MULTI_COMPONENT
done

if [ "${GH_ACTION^^}" == "Y" ]; then
    if [ ! -z "$RUNTIME_LANGUAGE" ] && echo "$RUNTIME_LANGUAGE" | jq . >/dev/null 2>&1; then # If RUNTIME_LANGUAGE is set and is valid JSON
        MULTI_COMPONENT="Y"
    fi
fi

writeLog "Multi-component option set to: $MULTI_COMPONENT"

# Gather Deployment Commands ========

# Helper functions to gather and validate component directory
gatherComponentDir() {

    COMPONENT_PATH="$2"
    if [ -z "$COMPONENT_PATH" ]; then
        read -p "$1, relative to project root directory (To Continue, Press Enter) →  "  COMPONENT_PATH
        writeLog "Prompted for component directory: $1"
    fi
    # Check that component path is valid
    VALID_COMPONENT_PATH=$(node /root/bin/js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$COMPONENT_PATH")
    writeLog "Validating component path: $COMPONENT_PATH"
    
    while [ "$VALID_COMPONENT_PATH" == "false" ] && [ "$COMPONENT_PATH" != "" ]; do
        if [ "${GH_ACTION^^}" == "Y" ]; then
            outputError "Invalid Component Path: \"$COMPONENT_PATH\". Make sure your path exists on the repository."
            writeLog "Invalid component path entered: $COMPONENT_PATH (GH_ACTION mode)"
            exit 14
        fi
        echo "⚠️ The component path you entered, \"$COMPONENT_PATH\", does not exist on branch, \"$PROJECT_BRANCH\", on repository at \"$PROJECT_REPOSITORY\"."
        writeLog "Invalid component path entered: $COMPONENT_PATH"
        if [ -z "$2" ]; then
            read -p "$1, relative to project root directory (To Continue, Press Enter) →  "  COMPONENT_PATH
            VALID_COMPONENT_PATH=$(node /root/bin/js/runner.js authenticateRepo "$PROJECT_REPOSITORY" "$PROJECT_BRANCH" "$COMPONENT_PATH")
        else
            exit 14
        fi
    done

    if [[ "$COMPONENT_PATH" == /* ]]; then
        COMPONENT_PATH="${COMPONENT_PATH:1}" # remove leading slash
    fi
    
    if [ "$COMPONENT_PATH" != "" ]; then
        writeLog "Component path validated: $COMPONENT_PATH"
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
    writeLog "Added component: $COMPONENT"
}

writeLog "Sourcing setup commands script"
source /root/bin/deployment-scripts/gatherSetupCommands.sh # Function to gather build, install, and start commands

writeLog "Sourcing environment variables script"
source /root/bin/deployment-scripts/gatherEnvVars.sh # Gather Environment Variables

writeLog "Gathering build commands"
gatherSetupCommands "BUILD" "🏗️  Enter the build command (leave blank if no build command) →  " # Gather Build Command(s)

writeLog "Gathering install commands"
gatherSetupCommands "INSTALL" "📦 Enter the install command (e.g., 'npm install') →  " # Gather Install Command(s)

writeLog "Gathering start commands"
gatherSetupCommands "START" "🚦 Enter the start command (e.g., 'npm start', 'python app.py') →  " # Gather Start Command(s)

if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
    if [ -z "$ROOT_START_COMMAND" ]; then
        read -p "📍 If your container requires a start command at the root directory, i.e. Docker run, enter it here (leave blank for no command) →  " ROOT_START_COMMAND
        writeLog "Prompted for root start command"
    fi
    if [ "$ROOT_START_COMMAND" != "" ]; then
        writeLog "Root start command set: $ROOT_START_COMMAND"
    fi
fi

# Get Runtime Language ========

writeLog "Sourcing runtime languages script"
source /root/bin/deployment-scripts/gatherRuntimeLangs.sh

# Get Services ========
writeLog "Sourcing services script"
source /root/bin/deployment-scripts/gatherServices.sh

writeLog "Deployment process finished successfully"
echo -e "\n✅ Deployment Process Finished.\n"