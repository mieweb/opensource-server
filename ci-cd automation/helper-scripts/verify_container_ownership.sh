#!/bin/bash
# Script to verify container ownership based on name and CTID
# Last Modified by Maxwell Klema on July 13th, 2025
# -----------------------------------------------------

CONTAINER_NAME="${CONTAINER_NAME,,}"

if [ -z "$CONTAINER_NAME" ]; then
    read -p "Enter Container Name →  " CONTAINER_NAME
fi

CONTAINER_ID=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$CONTAINER_NAME" '$3 == name {print $1}')

if [ -z "$CONTAINER_ID" ]; then
    echo "✅ Container with name \"$CONTAINER_NAME\" is available for use."
    return 1
fi

if [ "$TYPE_RUNNER" != "true" ]; then
    if (( $CONTAINER_ID % 2 == 0 )); then
        CONTAINER_OWNERSHIP=$(ssh root@10.15.0.5 "pct config \"$CONTAINER_ID\" | grep "tags" | grep \"$PROXMOX_USERNAME\"")
    else
        CONTAINER_OWNERSHIP=$(pct config "$CONTAINER_ID" | grep "tags" | grep -E "(^|;)$PROXMOX_USERNAME(;|$)")
    fi
else
    CONTAINER_OWNERSHIP=$(ssh root@10.15.0.5 "pct config \"$CONTAINER_ID\" | grep "tags" | grep \"$PROXMOX_USERNAME\"")
    PVE1="false"
    if [ -z "$CONTAINER_OWNERSHIP" ]; then
        CONTAINER_OWNERSHIP=$(pct config "$CONTAINER_ID" | grep "tags" | grep -E "(^|;)$PROXMOX_USERNAME(;|$)")
        PVE1="true"
    fi  
fi

if [ -z "$CONTAINER_OWNERSHIP" ]; then
    echo "❌ You do not own the container with name \"$CONTAINER_NAME\"."
    outputError 1 "You do not own the container with name \"$CONTAINER_NAME\"."
fi
