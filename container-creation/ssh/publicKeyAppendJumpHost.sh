#!/bin/bash
# A script that appends a user's public key to the SSH jump host container to prevent them having to enter a password
# June 24th, 2025 Maxwell Klema

PUBLIC_KEY=$1
echo "PUBLIC_KEY: $PUBLIC_KEY"
JUMP_HOST="10.15.0.4" #temporary until jump server ready

# SSH into the Jump Host

ssh root@"$JUMP_HOST" "echo '$PUBLIC_KEY' >> /home/jump/.ssh/authorized_keys && systemctl restart ssh"

exit 0