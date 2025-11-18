#!/bin/bash

set -euo pipefail

if [[ -z "${1-}" || -z "${2-}" || -z "${4-}" ]]; then
    echo "Usage: $0 <CTID> <HTTP PORT> <PROTOCOL FILE [OPTIONAL]> <username>"
    exit 1
fi

CTID="$1"
http_port="$2"
ADDITIONAL_PROTOCOLS="${3-}"
proxmox_user="$4"

# Optional: AI_CONTAINER environment variable should be exported if running on AI node
AI_CONTAINER="${AI_CONTAINER:-N}"

# Overridable API URL for testing
API_URL="${API_URL:-https://create-a-container.opensource.mieweb.org}"

# Redirect stdout and stderr to a log file
LOGFILE="${LOGFILE:-/var/log/pve-hook-$CTID.log}"
exec > >(tee -a "$LOGFILE") 2>&1

# run_pct_exec function to handle AI containers
run_pct_exec() {
    local ctid="$1"
    shift
    local remote_cmd
    printf -v remote_cmd '%q ' "$@"

    case "${AI_CONTAINER^^}" in
        PHOENIX)
            ssh root@10.15.0.6 "pct exec $ctid -- $remote_cmd"
            ;;
        FORTWAYNE)
            ssh root@10.250.0.2 "pct exec $ctid -- $remote_cmd"
            ;;
        N|"")
            pct exec "$ctid" -- "$@"
            ;;
        *)
            echo "❌ Invalid AI_CONTAINER value: $AI_CONTAINER" >&2
            exit 1
            ;;
    esac
}

# run_pct_config function to fetch config
run_pct_config() {
    local ctid="$1"
    case "${AI_CONTAINER^^}" in
        PHOENIX)
            ssh root@10.15.0.6 "pct config $ctid"
            ;;
        FORTWAYNE)
            ssh root@10.250.0.2 "pct config $ctid"
            ;;
        N|"")
            pct config "$ctid"
            ;;
        *)
            echo "❌ Invalid AI_CONTAINER value: $AI_CONTAINER" >&2
            exit 1
            ;;
    esac
}

# Extract IP
container_ip=""
attempts=0
max_attempts=5

while [[ -z "$container_ip" && $attempts -lt $max_attempts ]]; do
    container_ip=$(run_pct_exec "$CTID" ip -4 addr show eth0 | awk '/inet / {print $2}' | cut -d'/' -f1)
    [[ -z "$container_ip" ]] && sleep 2 && ((attempts++))
done

if [[ -z "$container_ip" ]]; then
    echo "❌ Failed to obtain IP for container $CTID"
    exit 1
fi

hostname=$(run_pct_exec "$CTID" hostname)
os_release=$(run_pct_exec "$CTID" grep '^ID=' /etc/os-release | cut -d'=' -f2 | tr -d '"')

# === NEW: Extract MAC address using cluster-aware function ===
mac=$(run_pct_config "$CTID" | grep -oP 'hwaddr=\K([^\s,]+)')

# Take input file of protocols, check if the container already has a port assigned for those protocols in PREROUTING
# Store all protocols and ports to write to JSON list later.
if [ ! -z "$ADDITIONAL_PROTOCOLS" ]; then
    list_all_protocols=()
    list_all_ports=()

    while read line; do
        protocol=$(echo "$line" | awk '{print $1}')
        port=$(echo "$line" | awk '{print $3}')
        list_all_protocols+=("$protocol")
        list_all_ports+=("$port")
    done < <(tac "$ADDITIONAL_PROTOCOLS")

    # Space Seperate Lists
    ss_protocols="$(IFS=, ; echo "${list_all_protocols[*]}")"

    # Register container with additional protocols via API
    response="$(curl -X POST "$API_URL/containers" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data-urlencode "hostname=$hostname" \
      --data-urlencode "ipv4Address=$container_ip" \
      --data-urlencode "username=$proxmox_user" \
      --data-urlencode "osRelease=$os_release" \
      --data-urlencode "containerId=$CTID" \
      --data-urlencode "macAddress=$mac" \
      --data-urlencode "aiContainer=$AI_CONTAINER" \
      --data-urlencode "httpPort=$http_port" \
      --data-urlencode "additionalProtocols=$ss_protocols")"
else
    # Register container without additional protocols via API
    response="$(curl -X POST "$API_URL/containers" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data-urlencode "hostname=$hostname" \
      --data-urlencode "ipv4Address=$container_ip" \
      --data-urlencode "username=$proxmox_user" \
      --data-urlencode "osRelease=$os_release" \
      --data-urlencode "containerId=$CTID" \
      --data-urlencode "macAddress=$mac" \
      --data-urlencode "aiContainer=$AI_CONTAINER" \
      --data-urlencode "httpPort=$http_port")"
fi

ssh_port="$(jq -r '.data.services[] | select(.type == "tcp" and .internalPort == 22) | .externalPort' <<< "$response")"

# Results
# Define high-contrast colors
BOLD='\033[1m'
BLUE='\033[34m'
MAGENTA='\033[35m'
GREEN='\033[32m'
CYAN='\033[36m'
RESET='\033[0m'

# Top border and title
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}🔔  ${MAGENTA}COPY THESE PORTS DOWN${RESET} — ${CYAN}For External Access${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "📌  ${BLUE}Note:${RESET} Your container listens on SSH Port 22 internally,"
echo -e "    but EXTERNAL traffic must use the SSH port listed below:"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Port info
echo -e "✅  ${GREEN}Hostname Registration:${RESET} $hostname → $container_ip"
echo -e "🔐  ${MAGENTA}SSH Port               :${RESET} $ssh_port"
echo -e "🌐  ${BLUE}HTTP Port              :${RESET} $http_port"

# Additional protocols (if any)
if [ ! -z "$ADDITIONAL_PROTOCOLS" ]; then
    for i in "${!list_all_protocols[@]}"; do
        internal_port="${list_all_ports[$i]}"
        service_info="$(jq -r --arg port "$internal_port" '.data.services[] | select(.internalPort == ($port | tonumber)) | "\(.externalPort)/\(.type)"' <<< "$response")"
        echo -e "📡  ${CYAN}${list_all_protocols[$i]} Port               :${RESET} $service_info"
    done
fi

# Bottom border
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"