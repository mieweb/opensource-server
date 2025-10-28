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


# Redirect stdout and stderr to a log file
LOGFILE="/var/log/pve-hook-$CTID.log"
exec > >(tee -a "$LOGFILE") 2>&1

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

# Determine which interface to use for iptables rules
if [[ "${AI_CONTAINER^^}" == "FORTWAYNE" ]]; then
    IPTABLES_IFACE="wg0"
else
    IPTABLES_IFACE="vmbr0"
fi

# Check if this container already has a SSH port assigned in PREROUTING
existing_ssh_port=$(iptables -t nat -S PREROUTING | grep "to-destination $container_ip:22" | awk -F'--dport ' '{print $2}' | awk '{print $1}' | head -n 1 || true)

if [[ -n "$existing_ssh_port" ]]; then
    echo "ℹ️ Container already has SSH port $existing_ssh_port"
    ssh_port="$existing_ssh_port"
else
    # Get used SSH ports
    used_ssh_ports=$(iptables -t nat -S PREROUTING | awk -F'--dport ' '/--dport / {print $2}' | awk '/22$/' | awk '{print $1}')
    ssh_port=$(comm -23 <(seq 2222 2999 | sort) <(echo "$used_ssh_ports" | sort) | head -n 1)

    if [[ -z "$ssh_port" ]]; then
        echo "❌ No available SSH ports found"
        exit 2
    fi

        # SSH PREROUTING rule
        iptables -t nat -A PREROUTING -i "$IPTABLES_IFACE" -p tcp --dport "$ssh_port" -j DNAT --to-destination "$container_ip:22"

        # SSH POSTROUTING rule
        iptables -t nat -A POSTROUTING -o "$IPTABLES_IFACE" -p tcp -d "$container_ip" --dport 22 -j MASQUERADE
    fi

# Take input file of protocols, check if the container already has a port assigned for those protocols in PREROUTING
# Store all protocols and ports to write to JSON list later.
if [ ! -z "$ADDITIONAL_PROTOCOLS" ]; then
    list_all_protocols=()
    list_all_ports=()

    while read line; do
        protocol=$(echo "$line" | awk '{print $1}')
        underlying_protocol=$(echo "$line" | awk '{print $2}')
        default_port_number=$(echo "$line" | awk '{print $3}')

        protocol_port=""
        existing_port=$(iptables -t nat -S PREROUTING | grep "to-destination $container_ip:$default_port_number" | awk -F'--dport ' '{print $2}' | awk '{print $1}' | head -n 1 || true)

        if [[ -n "$existing_port" ]]; then
            # Port already exists, so just assign it to protocol_port
            echo "ℹ️  This Container already has a $protocol port at $existing_port"
            protocol_port="$existing_port"
        else
            used_protocol_ports=$(iptables -t nat -S PREROUTING | awk -F'--dport ' '/--dport / {print $2}' | awk '{print $1}')
            protocol_port=$(comm -23 <(seq 10001 29999 | sort) <(echo "$used_protocol_ports" | sort) | head -n 1 || true)

            if [[ -z "protocol_port" ]]; then
                echo "❌ No available $protocol ports found"
                exit 2
            fi

            # Protocol PREROUTING rule
            iptables -t nat -A PREROUTING -i "$IPTABLES_IFACE" -p "$underlying_protocol" --dport "$protocol_port" -j DNAT --to-destination "$container_ip:$default_port_number"

            # Protocol POSTROUTING rule
            iptables -t nat -A POSTROUTING -o "$IPTABLES_IFACE" -p "$underlying_protocol" -d "$container_ip" --dport "$default_port_number" -j MASQUERADE

        fi

        list_all_protocols+=("$protocol")
        list_all_ports+=("$protocol_port")
    done < <(tac "$ADDITIONAL_PROTOCOLS")

    # Space Seperate Lists
    ss_protocols="$(IFS=, ; echo "${list_all_protocols[*]}")"
    ss_ports="$(IFS=, ; echo "${list_all_ports[*]}")"

    # Register container with additional protocols via API
    curl -X POST https://create-a-container.opensource.mieweb.org/containers \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data-urlencode "hostname=$hostname" \
      --data-urlencode "ipv4Address=$container_ip" \
      --data-urlencode "username=$proxmox_user" \
      --data-urlencode "osRelease=$os_release" \
      --data-urlencode "containerId=$CTID" \
      --data-urlencode "macAddress=$mac" \
      --data-urlencode "aiContainer=$AI_CONTAINER" \
      --data-urlencode "sshPort=$ssh_port" \
      --data-urlencode "httpPort=$http_port" \
      --data-urlencode "additionalProtocols=$ss_protocols" \
      --data-urlencode "additionalPorts=$ss_ports"
else
    # Register container without additional protocols via API
    curl -X POST https://create-a-container.opensource.mieweb.org/containers \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data-urlencode "hostname=$hostname" \
      --data-urlencode "ipv4Address=$container_ip" \
      --data-urlencode "username=$proxmox_user" \
      --data-urlencode "osRelease=$os_release" \
      --data-urlencode "containerId=$CTID" \
      --data-urlencode "macAddress=$mac" \
      --data-urlencode "aiContainer=$AI_CONTAINER" \
      --data-urlencode "sshPort=$ssh_port" \
      --data-urlencode "httpPort=$http_port"
fi

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
        echo -e "📡  ${CYAN}${list_all_protocols[$i]} Port               :${RESET} ${list_all_ports[$i]}"
    done
fi

# Bottom border
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"