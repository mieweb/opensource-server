#!/bin/bash

# Script to prune iptables rules for containers that no longer exist
# It fetches the port_map.json file from a remote host, checks for existing containers, and removes iptables rules for containers that are not present in the current Proxmox setup
# Location: /usr/local/bin/prune_iptables.sh
# Author: Carter Myers
set -euo pipefail

# Remote source of port_map.json
REMOTE_HOST="intern-nginx"
REMOTE_FILE="/etc/nginx/port_map.json"
LOCAL_FILE="/tmp/port_map.json"
LOG_FILE="/var/log/prune_iptables.log"

# List of Proxmox nodes in the cluster (add more if needed)
PVE_NODES=("localhost" "intern-phxdc-pve2")

# === 1. Fetch port_map.json ===
echo "[$(date)] Fetching port_map.json from $REMOTE_HOST..." >> "$LOG_FILE"
if ! scp "$REMOTE_HOST:$REMOTE_FILE" "$LOCAL_FILE" >/dev/null 2>&1; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ERROR: Could not fetch $REMOTE_FILE from $REMOTE_HOST" >> "$LOG_FILE"
    exit 1
fi

# === 2. Build list of existing hostnames across all PVE nodes ===
EXISTING_HOSTNAMES=""
for node in "${PVE_NODES[@]}"; do
    echo "[$(date)] Checking containers on $node..." >> "$LOG_FILE"
    if [[ "$node" == "localhost" ]]; then
        CTIDS=$(pct list | awk 'NR>1 {print $1}')
        for id in $CTIDS; do
            hn=$(pct config "$id" 2>/dev/null | grep -i '^hostname:' | awk '{print $2}')
            [[ -n "$hn" ]] && EXISTING_HOSTNAMES+="$hn"$'\n'
        done
    else
        CTIDS=$(ssh "$node" "pct list | awk 'NR>1 {print \\$1}'" 2>/dev/null || true)
        for id in $CTIDS; do
            hn=$(ssh "$node" "pct config $id 2>/dev/null | grep -i '^hostname:' | awk '{print \\$2}'" 2>/dev/null || true)
            [[ -n "$hn" ]] && EXISTING_HOSTNAMES+="$hn"$'\n'
        done
    fi
done

# === 3. Delete iptables rules from PREROUTING and POSTROUTING ===
delete_rules_for_ip() {
    local ip="$1"
    local chain="$2"
    local hostname="$3"

    while true; do
        match=$(iptables -t nat -L "$chain" -n --line-numbers | grep "$ip" | head -n 1 || true)
        [[ -z "$match" ]] && break

        rule_num=$(echo "$match" | awk '{print $1}')
        port=$(echo "$match" | grep -oP 'dpt:\K[0-9]+' || echo "N/A")
        date_str=$(date '+%Y-%m-%d %H:%M:%S')

        echo "$date_str - Removed '$hostname' $ip : $port from $chain table" >> "$LOG_FILE"
        iptables -t nat -D "$chain" "$rule_num"
    done
}

# === 4. Process each entry in port_map.json ===
jq -r 'keys[]' "$LOCAL_FILE" | while read hostname; do
    if ! echo "$EXISTING_HOSTNAMES" | grep -iqx "$hostname"; then
        echo "[$(date)] Hostname $hostname not found on any node. Cleaning up iptables..." >> "$LOG_FILE"
        ip=$(jq -r --arg hn "$hostname" '.[$hn].ip' "$LOCAL_FILE")

        delete_rules_for_ip "$ip" "PREROUTING" "$hostname"
        delete_rules_for_ip "$ip" "POSTROUTING" "$hostname"
    fi
done