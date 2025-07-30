#!/bin/bash
# Script that checks if a user is authenticated in Proxmox PVE Realm @ opensource.mieweb.org 
# Last Modified by Maxwell Klema on July 13th, 2025
# -----------------------------------------------------

# Authenticate User (Only Valid Users can Create Containers)

if [ -z "$PROXMOX_USERNAME" ]; then
	read -p  "Enter Proxmox Username →  " PROXMOX_USERNAME
fi

if [ -z "$PROXMOX_PASSWORD" ]; then
	read -sp "Enter Proxmox Password →  " PROXMOX_PASSWORD
	echo ""
fi

USER_AUTHENTICATED=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateUser \"$PROXMOX_USERNAME\" \"$PROXMOX_PASSWORD\"")
RETRIES=3

while [ $USER_AUTHENTICATED == 'false' ]; do
	if [ $RETRIES -gt 0 ]; then
		echo "❌ Authentication Failed. Try Again"
		read -p  "Enter Proxmox Username →  " PROXMOX_USERNAME
		read -sp "Enter Proxmox Password →  " PROXMOX_PASSWORD
		echo ""

        USER_AUTHENTICATED=$(ssh root@10.15.234.122 "node /root/bin/js/runner.js authenticateUser \"$PROXMOX_USERNAME\" \"$PROXMOX_PASSWORD\"")
		RETRIES=$(($RETRIES-1))
	else
		echo "Too many incorrect attempts. Exiting..."
		exit 2
	fi
done

echo "🎉 Your proxmox account, $PROXMOX_USERNAME@pve, has been authenticated"