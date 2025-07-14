#!/bin/bash
# Script to verify container ownership based on name and CTID
# Last Modified by Maxwell Klema on July 13th, 2025
# -----------------------------------------------------

if [ -z "$CONTAINER_NAME" ]; then
    read -p "Enter Container Name →  " CONTAINER_NAME
fi

CONTAINER_ID=$( { pct list; ssh root@10.15.0.5 'pct list'; } | awk -v name="$CONTAINER_NAME" '$3 == name {print $1}')

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ Container with name \"$CONTAINER_NAME\" does not exist."
    exit 1
fi

if (( $CONTAINER_ID % 2 == 0 )); then
    CONTAINER_OWNERSHIP=$(ssh root@10.15.0.5 "pct config \"$CONTAINER_ID\" | grep "tags" | grep \"$PROXMOX_USERNAME\"")
else
    CONTAINER_OWNERSHIP=$(pct config "$CONTAINER_ID" | grep "tags" | grep -x "tags: $PROXMOX_USERNAME")
fi

if [ -z "$CONTAINER_OWNERSHIP" ]; then
    echo "❌ You do not own the container with name \"$CONTAINER_NAME\"."
    exit 2
fi
