#!/bin/bash
# Script to verify container ownership based on name and CTID
# Last Modified by Maxwell Klema on August 5th, 2025
# -----------------------------------------------------

CONTAINER_NAME="${CONTAINER_NAME,,}"
CONTAINER_ID=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$CONTAINER_NAME" '$3 == name {print $1}')

if [ -z "$CONTAINER_ID" ]; then
    echo "✅ Container with name \"$CONTAINER_NAME\" is available for use."
    return 0
fi

CONTAINER_OWNERSHIP=$(ssh root@10.15.20.69 -- "jq '.\"$CONTAINER_NAME\".user' /etc/nginx/port_map.json")
CONTAINER_OWNERSHIP="${CONTAINER_OWNERSHIP//\"/}"
if [ "$TYPE_RUNNER" == "true" ] && (( $CONTAINER_ID % 2 == 0 )); then
    PVE1="false"
elif [ "$TYPE_RUNNER" == "true" ] && (( $CONTAINER_ID % 2 != 0 )); then
    PVE1="true"
fi

if [ "$CONTAINER_OWNERSHIP" != "$PROXMOX_USERNAME" ] && [ "$CONTAINER_OWNERSHIP" != "null" ]; then
    echo "❌ You do not own the container with name \"$CONTAINER_NAME\"."
    outputError 1 "You do not own the container with name \"$CONTAINER_NAME\"."