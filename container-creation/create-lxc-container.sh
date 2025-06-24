#!/bin/bash
# Main Container Creation Script
# Modified June 23rd, 2025 by Maxwell Klema
# ------------------------------------------

# Authenticate User (Only Valid Users can Create Containers)

read -p  "Enter Proxmox Username →  " PROXMOX_USERNAME
read -sp "Enter Proxmox Password →  " PROXMOX_PASSWORD
echo ""

USER_AUTHENTICATED=$(node /root/bin/js/authenticateUserRunner.js authenticateUser "$PROXMOX_USERNAME" "$PROXMOX_PASSWORD")
RETRIES=3

while [ $USER_AUTHENTICATED == 'false' ]; do
	if [ $RETRIES -gt 0 ]; then
		echo "❌ Authentication Failed. Try Again"
		read -p  "Enter Proxmox Username →  " PROXMOX_USERNAME
		read -sp "Enter Proxmox Password →  " PROXMOX_PASSWORD
		echo ""

		USER_AUTHENTICATED=$(node /root/bin/js/authenticateUserRunner.js authenticateUser "$PROXMOX_USERNAME" "$PROXMOX_PASSWORD")
		RETRIES=$(($RETRIES-1))
	else
		echo "Too many incorrect attempts. Exiting..."
		exit 0
	fi
done

echo "🎉 You have been authenticated"

# Gather Container Details

if [ -z "$CONTAINER_NAME" ]; then
	read -p "Enter Application Name (One-Word) →  " CONTAINER_NAME
fi

HOST_NAME_EXISTS=$(ssh root@10.15.20.69 "node /etc/nginx/checkHostnameRunner.js checkHostnameExists ${CONTAINER_NAME}")

while [ $HOST_NAME_EXISTS == 'true' ]; do
	echo "Sorry! That name has already been registered. Try another name"
	read -p "Enter Application Name (One-Word) →  " CONTAINER_NAME
	HOST_NAME_EXISTS=$(ssh root@10.15.20.69 "node /etc/nginx/checkHostnameRunner.js checkHostnameExists ${CONTAINER_NAME}")
done

echo "✅ $CONTAINER_NAME is available"

if [ -z "$CONTAINER_PASSWORD" ]; then
	read -sp "Enter Container Password →  " CONTAINER_PASSWORD
	echo
	read -sp "Confirm Container Password →  " CONFIRM_PASSWORD
	echo

	while [[ "$CONFIRM_PASSWORD" != "$CONTAINER_PASSWORD" || ${#CONTAINER_PASSWORD} -lt 8 ]]; do
        	echo "Sorry, try again. Ensure passwords are at least 8 characters."
        	read -sp "Enter Container Password →  " CONTAINER_PASSWORD
        	echo
        	read -sp "Confirm Container Password →  " CONFIRM_PASSWORD
        	echo
	done
fi

# Attempt to detect public keys

echo -e "\n🔑 Attempting to Detect SSH Public Key..."
echo "FP: $SSH_KEY_FP"

KEY_FILE="/root/bin/ssh/temp_pubs/key.pub"
AUTHORIZED_KEYS="/root/.ssh/authorized_keys"
DETECT_PUBLIC_KEY=$(sudo /root/bin/ssh/detectPublicKey.sh "$SSH_KEY_FP")

if [ "$DETECT_PUBLIC_KEY" == "Public key found for create-container" ]; then
	PUBLIC_KEY_FILE="$KEY_FILE"
	echo "🔐 Public Key Found!"
else
	echo "🔍 Could not detect Public Key"

	if [ -z "$PUBLIC_KEY" ]; then
		read -p "Enter Public Key (Allows Easy Access to Container) [OPTIONAL - LEAVE BLANK TO SKIP] →  " PUBLIC_KEY
		PUBLIC_KEY_FILE="$KEY_FILE"

		# Check if key is valid

		while [[ "$PUBLIC_KEY" != "" && $(echo "$PUBLIC_KEY" | ssh-keygen -l -f - 2>&1 | tr -d '\r') == "(stdin) is not a public key file." ]]; do
			echo "❌ \"$PUBLIC_KEY\" is not a valid key. Enter either a valid key or leave blank to skip."
			read -p "Enter Public Key (Allows Easy Access to Container) [OPTIONAL - LEAVE BLANK TO SKIP] →  " PUBLIC_KEY
		done

		if [ "$PUBLIC_KEY" == "" ]; then
			echo "" > "$KEY_FILE"
		else
			echo "$PUBLIC_KEY" > "$KEY_FILE"
			echo "$PUBLIC_KEY" > "$AUTHORIZED_KEYS" && systemctl restart ssh
			sudo /root/bin/ssh/publicKeyAppendJumpHost.sh "$(cat $PUBLIC_KEY_FILE)"
		fi

	else
		echo "$PUBLIC_KEY" > "$KEY_FILE"
		echo "$PUBLIC_KEY" > "$AUTHORIZED_KEYS" && systemctl restart ssh
	fi
fi