# This script scrapes containers that no longer exist and removes them from the Wazuh manager.
# Last Modified by Maxwell Klema on August 7th, 2025
# --------------------------------------------------

LOG_FILE="/var/log/prune_agents.log"
PCT_BIN="/usr/sbin/pct"
PVE_NODES=("localhost" "10.15.0.5")

write_log() {
    message="$1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] - $message" >> "$LOG_FILE"
}

# Scrape a list of containers on PVE1 and PVE2

EXISTING_HOSTNAMES=""
EXISTING_AGENTS=""

for node in ${PVE_NODES[@]}; do
    if [ "$node" == "localhost" ]; then
        if ! command -v "$PCT_BIN" &> /dev/null; then
            write_log "❌ Error: $PCT_BIN not found on localhost."
            exit 1
        fi

        HOSTNAMES=$("$PCT_BIN" list | awk 'NR>1 {print $3}' || true)

        while read -r hostname; do
            [[ -n "$hostname" ]] && EXISTING_HOSTNAMES+="$hostname"$'\n'
        done <<< "$HOSTNAMES"

        write_log "Retrieved hostnames from localhost:"
        write_log "$HOSTNAMES"
    else
        HOSTNAMES_CMD="${PCT_BIN} list | awk 'NR>1 {print \$3}' || true"
        HOSTNAMES=$(ssh "$node" "$HOSTNAMES_CMD")

        if [[ "$CTIDS_OUTPUT" =~ "Permission denied" || "$CTIDS_OUTPUT" =~ "Connection refused" || "$CTIDS_OUTPUT" =~ "Host key verification failed" ]]; then
            log_message "ERROR: SSH to $node failed: $CTIDS_OUTPUT"
            continue
        fi

        while read -r hostname; do
            [[ -n "$hostname" ]] && EXISTING_HOSTNAMES+="$hostname"$'\n'
        done <<< "$HOSTNAMES"

        write_log "Retrieved hostnames from $node:"
        write_log "$HOSTNAMES"
    fi
done

# Scrape a list of containers (agent-names) on the Wazuh manager

EXISTING_AGENTS=$(node /var/lib/vz/snippets/Wazuh/runner.js getAgents | sed '1d')

write_log "Retrieved agents from Wazuh manager:"
write_log "$AGENTS"

# Iterate over each agent and if a existing host name does not exist, delete the agent.

while read -r agent; do
    if ! echo "$EXISTING_HOSTNAMES" | grep -q "^$agent$" && [[ ! "$agent" =~ ^intern-phxdc-pve[0-9]$ ]]; then
        write_log "Removing agent $agent from Wazuh manager..."
        REMOVE_AGENT=$(node /var/lib/vz/snippets/Wazuh/runner.js deleteAgent "$agent")
        if [ "$REMOVE_AGENT" == "success" ]; then
            write_log "✅ Successfully removed agent $agent."
        else
            write_log "❌ Failed to remove agent $agent."
        fi
    else
        write_log "Agent $agent is still active. No action taken."
    fi
done <<< "$EXISTING_AGENTS"
