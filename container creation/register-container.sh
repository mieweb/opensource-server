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

# Redirect stdout and stderr to a log file
LOGFILE="/var/log/pve-hook-$CTID.log"
exec > >(tee -a "$LOGFILE") 2>&1

# Extract IP
container_ip=""
attempts=0
max_attempts=5

while [[ -z "$container_ip" && $attempts -lt $max_attempts ]]; do
  container_ip=$(pct exec "$CTID" -- ip -4 addr show eth0 | awk '/inet / {print $2}' | cut -d'/' -f1)
  [[ -z "$container_ip" ]] && sleep 2 && ((attempts++))
done

if [[ -z "$container_ip" ]]; then
    echo "❌ Failed to obtain IP for container $CTID"
    exit 1
fi

hostname=$(pct exec "$CTID" -- hostname)
os_release=$(pct exec "$CTID" -- grep '^ID=' /etc/os-release | cut -d'=' -f2 | tr -d "\"")

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

    # Add PREROUTING rule
    iptables -t nat -A PREROUTING -i vmbr0 -p tcp --dport "$ssh_port" -j DNAT --to-destination "$container_ip:22"

    # Add POSTROUTING rule
    iptables -t nat -A POSTROUTING -o vmbr0 -p tcp -d "$container_ip" --dport 22 -j MASQUERADE
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

            # Add PREROUTING rule
            iptables -t nat -A PREROUTING -i vmbr0 -p "$underlying_protocol" --dport "$protocol_port" -j DNAT --to-destination "$container_ip:$default_port_number"

            # Add POSTROUTING rule
            iptables -t nat -A POSTROUTING -o vmbr0 -p "$underlying_protocol" -d "$container_ip" --dport "$default_port_number" -j MASQUERADE
        fi

        list_all_protocols+=("$protocol")
        list_all_ports+=("$protocol_port")
    done < <(tac "$ADDITIONAL_PROTOCOLS")

    # Space Seperate Lists
    ss_protocols="$(IFS=, ; echo "${list_all_protocols[*]}")"
    ss_ports="$(IFS=, ; echo "${list_all_ports[*]}")"

    #Update NGINX port map JSON on the remote host safely using a heredoc and positional parameters

    ssh root@10.15.20.69 bash -s -- "$hostname" "$container_ip" "$ssh_port" "$http_port" "$ss_protocols" "$ss_ports" "$proxmox_user" "$os_release" <<'EOF'
set -euo pipefail

hostname="$1"
container_ip="$2"
ssh_port="$3"
http_port="$4"
protos_json=$(echo "$5" | tr ',' '\n' | jq -R . | jq -s .)
ports_json=$(echo "$6" | tr ',' '\n' | jq -R . | jq -s 'map(tonumber)')
user="$7"
os_release="$8"
root_pswd="$9"

jq --arg hn "$hostname" \
  --arg ip "$container_ip" \
  --arg user "$user" \
  --arg root_pswd "$root_pswd" \
  --arg osr "$os_release" \
  --argjson ssh "$ssh_port" \
  --argjson http "$http_port" \
  --argjson protos "$protos_json" \
  --argjson ports_list "$ports_json" \
  '. + {($hn): {
      ip: $ip,
      user: $user,
      os_release: $osr,
      ports: ( reduce range(0; $protos | length) as $i (
          {ssh: $ssh, http: $http};
          . + { ($protos[$i]): $ports_list[$i]}
      ))
  }}' /etc/nginx/port_map.json > /tmp/port_map.json.new

mv -f /tmp/port_map.json.new /etc/nginx/port_map.json
nginx -s reload
EOF
else
    # Update NGINX port map JSON on the remote host safely using a heredoc and positional parameters
    ssh root@10.15.20.69 bash -s -- "$hostname" "$container_ip" "$ssh_port" "$http_port" "$proxmox_user" "$os_release" <<'EOF'
set -euo pipefail

hostname="$1"
container_ip="$2"
ssh_port="$3"
http_port="$4"
user="$5"
os_release="$6"

jq --arg hn "$hostname" \
  --arg ip "$container_ip" \
  --arg user "$user" \
  --arg osr "$os_release" \
  --argjson http "$http_port" \
  --argjson ssh "$ssh_port" \
  '. + {($hn): {
      ip: $ip,
      user: $user,
      os_release: $osr,
      ports: {ssh: $ssh, http: $http}
  }}' /etc/nginx/port_map.json > /tmp/port_map.json.new

mv -f /tmp/port_map.json.new /etc/nginx/port_map.json
nginx -s reload
EOF
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
