#!/bin/bash
# Detect if the user in the current session logged in via an SSH public key
# Last Updated June 25th 2025 Maxwell Klema

USER="create-container" #Change Later
PUBLIC_KEY_LIST="/root/.ssh/authorized_keys"

RANDOM_NUM=$(shuf -i 100000-999999 -n 1)
TEMP_PUB_FILE="/root/bin/ssh/temp_pubs/key_$RANDOM_NUM.pub" # in case two users are running this script at the same time, they do not overwrite each other's temp files
echo "" > "$TEMP_PUB_FILE"


KEY_FINGERPRINT="$1"

if [ "$KEY_FINGERPRINT" != "" ]; then
    # Iterate over each public key, compute fingerprint, see if there is a match
 
     while read line; do
        echo "$line" > "$TEMP_PUB_FILE"
        PUB_FINGERPRINT=$(ssh-keygen -lf "$TEMP_PUB_FILE" | awk '{print $2}')
        if [[ "$PUB_FINGERPRINT" == "$KEY_FINGERPRINT" ]]; then
            echo "Public key found for $USER"
            rm -rf "$TEMP_PUB_FILE"
            exit 0
        fi
    done < <(tac $PUBLIC_KEY_LIST) #Iterates backwards without creating subprocess (allows exit in loop)

    echo "" > "$TEMP_PUB_FILE"
fi

rm -rf "$TEMP_PUB_FILE"