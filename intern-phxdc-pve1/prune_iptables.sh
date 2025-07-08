#!/bin/bash

# Script to prune iptables rules for containers that no longer exist
# Author: Carter Myers

# Enable strict mode:
# -e: Exit immediately if a command exits with a non-zero status.
# -u: Treat unset variables as an error when substituting.
# -o pipefail: The return value of a pipeline is the status of the last command
#              to exit with a non-zero status, or zero if all commands exit successfully.
set -euo pipefail

# --- Configuration ---
REMOTE_HOST="intern-nginx"
REMOTE_FILE="/etc/nginx/port_map.json"
LOCAL_FILE="/tmp/port_map.json"
LOG_FILE="/var/log/prune_iptables.log"
PVE_NODES=("localhost" "10.15.0.5")

# Function to log messages with a timestamp
log_message() {
    echo "[$(date)] $1" >> "$LOG_FILE"
}

# --- 1. Fetch port_map.json from remote host ---
log_message "Fetching port_map.json from $REMOTE_HOST..."
if ! scp "$REMOTE_HOST:$REMOTE_FILE" "$LOCAL_FILE" >/dev/null 2>&1; then
    log_message "ERROR: Could not fetch $REMOTE_FILE from $REMOTE_HOST"
    exit 1
fi
log_message "Successfully fetched $REMOTE_FILE to $LOCAL_FILE."

# --- 2. Build list of existing hostnames ---
EXISTING_HOSTNAMES=""
for node in "${PVE_NODES[@]}"; do
    log_message "Checking containers on $node..."
    if [[ "$node" == "localhost" ]]; then
        CTIDS=$(pct list | awk 'NR>1 {print $1}' || true)
        log_message "DEBUG: Local CTIDs: [${CTIDS:-}]"
        for id in $CTIDS; do
            hn=$(pct config "$id" 2>/dev/null | grep -i '^hostname:' | awk '{print $2}' | tr -d '[:space:]' || true)
            [[ -n "$hn" ]] && EXISTING_HOSTNAMES+="$hn"$'\n'
        done
    else
        log_message "DEBUG: Checking remote node: $node"
        CTIDS_CMD="pct list | awk 'NR>1 {print \$1}'"
        CTIDS_OUTPUT=$(ssh "$node" "$CTIDS_CMD" 2>&1 || true)
        if [[ "$CTIDS_OUTPUT" =~ "Permission denied" || "$CTIDS_OUTPUT" =~ "Connection refused" || "$CTIDS_OUTPUT" =~ "Host key verification failed" ]]; then
            log_message "ERROR: SSH to $node failed: $CTIDS_OUTPUT"
            continue
        fi
        log_message "DEBUG: CTIDs on $node: [${CTIDS_OUTPUT:-}]"
        for id in $CTIDS_OUTPUT; do
            HN_CMD="pct config $id 2>/dev/null | grep -i '^hostname:' | awk '{print \$2}'"
            HN_OUTPUT=$(ssh "$node" "$HN_CMD" 2>&1 || true)
            if [[ "$HN_OUTPUT" =~ "Permission denied" || "$HN_OUTPUT" =~ "No such file" ]]; then
                log_message "ERROR: Failed to get hostname for $id on $node: $HN_OUTPUT"
                continue
            fi
            hn=$(echo "$HN_OUTPUT" | tr -d '[:space:]')
            [[ -n "$hn" ]] && EXISTING_HOSTNAMES+="$hn"$'\n'
        done
    fi
done

# Remove any empty lines from EXISTING_HOSTNAMES
EXISTING_HOSTNAMES=$(echo "$EXISTING_HOSTNAMES" | sed '/^$/d')
log_message "Existing hostnames collected:"
log_message "$EXISTING_HOSTNAMES"

# --- 3. Prune iptables and port_map.json ---
log_message "Pruning iptables and port_map.json..."
cp "$LOCAL_FILE" "$LOCAL_FILE.bak"
log_message "Created backup of $LOCAL_FILE at $LOCAL_FILE.bak"

HOSTNAMES_IN_JSON=$(jq -r 'keys[]' "$LOCAL_FILE")
mapfile -t EXISTING_ARRAY <<< "$EXISTING_HOSTNAMES"

# Helper function to check if a hostname exists in the collected list
hostname_exists() {
    local h=$(echo "$1" | tr -d '[:space:]')
    for existing in "${EXISTING_ARRAY[@]}"; do
        if [[ "${h,,}" == "${existing,,}" ]]; then # Case-insensitive comparison
            return 0
        fi
    done
    return 1
}

for hostname in $HOSTNAMES_IN_JSON; do
    trimmed_hostname=$(echo "$hostname" | tr -d '[:space:]')
    if hostname_exists "$trimmed_hostname"; then
        log_message "Keeping entry: $trimmed_hostname"
    else
        ip=$(jq -r --arg h "$hostname" '.[$h].ip // "unknown"' "$LOCAL_FILE")
        ports=$(jq -c --arg h "$hostname" '.[$h].ports // {}' "$LOCAL_FILE")
        log_message "Stale entry detected: $hostname (IP: $ip, Ports: $ports) - removing..."

        # --- IPTABLES REMOVAL ---
        # Capture rules into an array first to avoid subshell issues with 'while read'
        mapfile -t RULES_TO_DELETE < <(sudo iptables -t nat -S | grep "$hostname" || true) # Added sudo, || true to prevent pipefail if grep finds nothing
        
        if [[ ${#RULES_TO_DELETE[@]} -gt 0 ]]; then
            log_message "Found ${#RULES_TO_DELETE[@]} iptables rules for $hostname. Attempting removal..."
            for rule in "${RULES_TO_DELETE[@]}"; do
                cleaned_rule=$(echo "$rule" | sed 's/^-A /-D /')
                log_message "Attempting to remove iptables rule: sudo iptables -t nat $cleaned_rule"
                if sudo iptables -t nat $cleaned_rule; then 
                    log_message "Removed iptables rule: $cleaned_rule"
                else
                    log_message "ERROR: Failed to remove iptables rule: $cleaned_rule (Exit status: $?)"
                fi
            done
        else
            log_message "No iptables rules found for $hostname to remove."
        fi

        # --- JSON ENTRY REMOVAL ---
        log_message "Attempting to remove $hostname from local port_map.json..."
        if jq "del(.\"$hostname\")" "$LOCAL_FILE" > "${LOCAL_FILE}.tmp"; then
            if mv "${LOCAL_FILE}.tmp" "$LOCAL_FILE"; then
                log_message "Successfully removed $hostname from local port_map.json."
            else
                log_message "ERROR: Failed to move temporary file to $LOCAL_FILE for $hostname."
                exit 1 # Critical failure, exit
            fi
        else
            log_message "ERROR: jq failed to delete $hostname from $LOCAL_FILE."
            exit 1 # Critical failure, exit
        fi

        # Confirm deletion from local file
        if jq -e --arg h "$hostname" 'has($h)' "$LOCAL_FILE" >/dev/null; then
            log_message "ERROR: $hostname still exists in local port_map.json after deletion attempt!"
        else
            log_message "Confirmed $hostname removed from local port_map.json."
        fi
    fi
done

# --- 4. Upload and verify updated file on remote ---
log_message "Uploading updated port_map.json to $REMOTE_HOST..."
TEMP_REMOTE="/tmp/port_map.json"

if scp "$LOCAL_FILE" "$REMOTE_HOST:$TEMP_REMOTE" >/dev/null 2>&1; then
    log_message "Uploaded to $REMOTE_HOST:$TEMP_REMOTE"
else
    log_message "ERROR: Failed to upload $TEMP_REMOTE to $REMOTE_HOST"
    exit 1
fi

# Check if deleted hostnames still exist in uploaded file
log_message "Verifying remote file content..."
for hostname in $HOSTNAMES_IN_JSON; do
    if ! hostname_exists "$hostname"; then # Only check for hostnames that *should* have been deleted
        if ssh "$REMOTE_HOST" "grep -q '\"$hostname\"' $TEMP_REMOTE"; then
            log_message "WARNING: $hostname still exists in uploaded $TEMP_REMOTE on $REMOTE_HOST!"
        else
            log_message "Verified $hostname was removed in uploaded file on $REMOTE_HOST."
        fi
    fi
done

# Move uploaded file into place on the remote host
log_message "Moving uploaded file into final position on $REMOTE_HOST..."
if ssh "$REMOTE_HOST" "sudo cp $TEMP_REMOTE $REMOTE_FILE && sudo chown root:root $REMOTE_FILE && sudo chmod 644 $REMOTE_FILE && rm $TEMP_REMOTE"; then
    log_message "Copied updated port_map.json to $REMOTE_FILE on $REMOTE_HOST"
else
    log_message "ERROR: Failed to replace $REMOTE_FILE on $REMOTE_HOST"
    exit 1
fi

log_message "Prune complete."