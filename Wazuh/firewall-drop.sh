#!/bin/bash

# Custom Firewall Drop Script
# This script will be called by Wazuh active response
#
# Usage: This script reads JSON input from STDIN
# Expected JSON format:
# {
#   "version": 1,
#   "command": "add|delete", 
#   "parameters": {
#     "alert": {
#       "data": {
#         "srcip": "IP_ADDRESS"
#       }
#     }
#   }
# }

SCRIPT_NAME="my-custom-firewall-drop"
LOG_FILE="/var/ossec/logs/active-responses.log"

log_message() {
    echo "$(date '+%Y/%m/%d %H:%M:%S') $SCRIPT_NAME: $1" >> "$LOG_FILE"
}

# Read JSON input from STDIN
read -r INPUT

log_message "Received input: $INPUT"

# Parse JSON to extract command and srcip
COMMAND=$(echo "$INPUT" | jq -r '.command // empty')
SRCIP=$(echo "$INPUT" | jq -r '.parameters.alert.data.srcip // empty')

# Validate input
if [[ -z "$COMMAND" || -z "$SRCIP" ]]; then
    log_message "ERROR: Invalid input - missing command or srcip"
    exit 1
fi

log_message "Command: $COMMAND, Source IP: $SRCIP"

# Validate IP address format
if ! [[ "$SRCIP" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
    log_message "ERROR: Invalid IP address format: $SRCIP"
    exit 1
fi

# Function to add firewall rule
add_rule() {
    local ip="$1"
    log_message "Adding firewall rule to block $ip"
    
    if ! iptables -C INPUT -s "$ip" -j DROP 2>/dev/null; then
        iptables -I INPUT -s "$ip" -j DROP 2>/dev/null
    fi 

    if ! iptables -C FORWARD -s "$ip" -j DROP 2>/dev/null; then
        iptables -I FORWARD -s "$ip" -j DROP 2>/dev/null
    fi 
}

# Function to remove firewall rule
remove_rule() {
    local ip="$1"
    log_message "Removing firewall rule for $ip"
    
    # Remove iptables rules
    iptables -D INPUT -s "$ip" -j DROP 2>/dev/null
    if [[ $? -eq 0 ]]; then
        log_message "Successfully removed INPUT rule for $ip"
    else
        log_message "WARNING: INPUT rule for $ip may not exist or already removed"
    fi
    
    iptables -D FORWARD -s "$ip" -j DROP 2>/dev/null
    if [[ $? -eq 0 ]]; then
        log_message "Successfully removed FORWARD rule for $ip"
    else
        log_message "WARNING: FORWARD rule for $ip may not exist or already removed"
    fi
    
    # Optional: Add custom cleanup logic here
}

# Execute based on command
case "$COMMAND" in
    "add")
        add_rule "$SRCIP"
        ;;
    "delete")
        remove_rule "$SRCIP"
        ;;
    *)
        log_message "ERROR: Unknown command: $COMMAND"
        exit 1
        ;;
esac

log_message "Script execution completed for $COMMAND $SRCIP"
exit 0

