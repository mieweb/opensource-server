#!/bin/bash
# Script to delete a container permanently
# Last Modified by Maxwell Klema on July 13th, 2025
# -----------------------------------------------------

RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🗑️  Delete Container ${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

CMD=(
bash /var/lib/vz/snippets/helper-scripts/delete-runner.sh
"$PROJECT_REPOSITORY"
"$GITHUB_PAT"
"$PROXMOX_USERNAME"
"$PROXMOX_PASSWORD"
"$CONTAINER_NAME"
)

# Safely quote each argument for the shell
QUOTED_CMD=$(printf ' %q' "${CMD[@]}")

tmux new-session -d -s delete-runner "$QUOTED_CMD"

echo "✅ Container with name \"$CONTAINER_NAME\" will been permanently deleted."
exit 0 # Container Deleted Successfully