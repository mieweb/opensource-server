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
    read -p "🪾  Enter the project branch to deploy from (leave blank for main) → " PROJECT_BRANCH
fi

if [ "$PROJECT_BRANCH" == "" ]; then
    PROJECT_BRANCH="main"
fi

while ! git ls-remote --heads "$PROJECT_REPOSITORY" | grep -q "refs/heads/$PROJECT_BRANCH"; do
    echo "⚠️ The branch you provided, \"$PROJECT_BRANCH\", does not exist on repository at \"$PROJECT_REPOSITORY\"."
    read -p "🪾  Enter the project branch to deploy from (leave blank for main) → " PROJECT_BRANCH
done

# Get Project Root Directory

if [ -z "$PROJECT_ROOT" ]; then
    read -p "📁 Enter the project root directory (relative to repo root, or '.' for root) →  " PROJECT_ROOT
fi

# Get Environment Variables
if [ -z "$ENV_VARS" ]; then
    read -p "🔑 Enter any environment variables (KEY=VALUE, comma separated, leave blank if none) →  " ENV_VARS
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

