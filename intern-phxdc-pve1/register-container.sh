#!/bin/bash

# /var/lib/vz/snippets/register-container.sh
# This script registers a Proxmox container with the host's NGINX proxy and assigns it an available HTTP and SSH port.
# Last updated: 06-08-2025 Carter Myers
# ----------------------------------------
set -euo pipefail
set -x

CTID="$1"
if [ -z "$CTID" ]; then
    echo "Usage: $0 <CTID>"
    exit 1
fi

# Redirect stdout and stderr to a log file
LOGFILE="/var/log/pve-hook-$CTID.log"
exec > >(tee -a "$LOGFILE") 2>&1

echo "---- Hookscript started at $(date) ----"
echo "⏳ Waiting for container to boot and get DHCP lease..."
sleep 10

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

# Get available HTTP port (3000–3999)
used_http_ports=$(ssh root@10.15.20.69 'jq -r ".[] | .port" /etc/nginx/port_map.json 2>/dev/null || echo ""')
http_port=$(comm -23 <(seq 3000 3999 | sort) <(echo "$used_http_ports" | sort) | head -n 1)

# Check if this container already has a port assigned in PREROUTING
existing_ssh_port=$(iptables -t nat -S PREROUTING | grep "to-destination $container_ip:22" | awk -F'--dport ' '{print $2}' | awk '{print $1}' | head -n 1 || true)

if [[ -n "$existing_ssh_port" ]]; then
    echo "ℹ️ Container already has SSH port $existing_ssh_port"
    ssh_port="$existing_ssh_port"
else
    # Get used SSH ports
    used_ssh_ports=$(iptables -t nat -S PREROUTING | awk -F'--dport ' '/--dport / {print $2}' | awk '{print $1}')
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

# Update NGINX port map JSON on the remote host safely using a heredoc and positional parameters
ssh root@10.15.20.69 bash -s -- "$hostname" "$container_ip" "$http_port" "$ssh_port" <<'EOF'
set -euo pipefail

hostname="$1"
container_ip="$2"
http_port="$3"
ssh_port="$4"

jq --arg hn "$hostname" --arg ip "$container_ip" --argjson port "$http_port" --argjson ssh "$ssh_port" \
  '. + {($hn): {ip: $ip, port: $port, ssh: $ssh}}' /etc/nginx/port_map.json > /tmp/port_map.json.new

mv -f /tmp/port_map.json.new /etc/nginx/port_map.json
nginx -s reload
EOF

echo "✅ Registered $hostname → $container_ip"
echo "🌐 HTTP port: $http_port"
echo "🔐 SSH port: $ssh_port"