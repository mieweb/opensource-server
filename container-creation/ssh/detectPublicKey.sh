#!/bin/bash
# Detect if the user in the current session logged in via an SSH public key
# Last Updated June 17th 2025 Maxwell Klema

USER="create-container" #Change Later
PUBLIC_KEY_LIST="/root/.ssh/authorized_keys"
TEMP_PUB_FILE="/root/bin/ssh/temp_pubs/key.pub"
# SSH_CLIENT_IP=$(echo $SSH_CLIENT | awk '{print $1}')

# Extract latest public key fingerprint based on login from USER

# LAST_LOGIN=$(journalctl _COMM=sshd | grep "Accepted publickey for $USER from $SSH_CLIENT_IP" | tail -1 )
# KEY_FINGERPRINT=$(echo $LAST_LOGIN | grep -o 'SHA256[^ ]*')

KEY_FINGERPRINT="$1"

if [ KEY_FINGERPRINT != "" ]; then
    # Iterate over each public key, compute fingerprint, see if there is a match

    while read line; do
        echo "$line" > "$TEMP_PUB_FILE"
        PUB_FINGERPRINT=$(ssh-keygen -lf "$TEMP_PUB_FILE" | awk '{print $2}')
        if [[ "$PUB_FINGERPRINT" == "$KEY_FINGERPRINT" ]]; then
            echo "Public key found for $USER"
            exit 0
        fi
    done < <(tac $PUBLIC_KEY_LIST) #Iterates backwards without creating subprocess (allows exit in loop)

    echo "" > "$TEMP_PUB_FILE"
fi

echo "Nothing"


