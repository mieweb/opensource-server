#!/bin/bash
# Script to prune all temporary files (env vars, protocols, services, and public keys)
# Last Updated July 28th 2025 Maxwell Klema

LOG_FILE="/var/log/pruneTempFiles.log"

writeLog() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')]: $1" >> "$LOG_FILE"
}

# Function to remove temporary environment variable Folders
removeTempEnvVars() {
    TEMP_ENV_FOLDER="/root/bin/env"
    while read -r line; do
        if [[ "$line" == /root/bin/env/env_* ]]; then
            rm -rf "$line" > /dev/null 2>&1
            writeLog "Removed temporary environment variable folder: $line"
        fi
    done < <(find "$TEMP_ENV_FOLDER" -maxdepth 1 -type d -name "env_*")
}

# Function to remove temporary services file
removeTempServices() {
    TEMP_SERVICES_FOLDER="/root/bin/services"
    while read -r line; do
        if [[ "$line" == /root/bin/services/services_* ]]; then
            rm -f "$line"
            writeLog "Removed temporary services file: $line"
        fi
    done < <(find "$TEMP_SERVICES_FOLDER" -maxdepth 1 -type f -name "services_*")
}

# Function to remove temporary public key files
removeTempPublicKeys() {
    TEMP_PUB_FOLDER="/root/bin/ssh/temp_pubs"
    while read -r line; do
        if [[ "$line" == /root/bin/ssh/temp_pubs/key_* ]];
        then
            rm -f "$line"
            writeLog "Removed temporary public key file: $line"
        fi
    done < <(find "$TEMP_PUB_FOLDER" -maxdepth 1 -type f -name "key_*")
}

# Function to remove temporary protocol files
removeTempProtocols() {
    TEMP_PROTOCOL_FOLDER="/root/bin/protocols"
    while read -r line; do
        if [[ "$line" == /root/bin/protocols/protocol_list* ]]; then
            rm -f "$line"
            writeLog "Removed temporary protocol file: $line"
        fi
    done < <(find "$TEMP_PROTOCOL_FOLDER" -maxdepth 1 -type f -name "protocol_list*")
}

# Main function to prune all temporary files
pruneTempFiles() {
    writeLog "Starting to prune temporary files..."
    removeTempEnvVars
    removeTempServices
    removeTempPublicKeys
    removeTempProtocols
    writeLog "Finished pruning temporary files."
}

# Execute the main function
pruneTempFiles
exit 0