#!/bin/bash

# Helper function to gather environment variables
gatherEnvVars(){
    TEMP_ENV_FILE_PATH="$1"

    read -p "🔑 Enter Environment Variable Key →  " ENV_VAR_KEY
    read -p "🔑 Enter Environment Variable Value →  " ENV_VAR_VALUE

    while [ "$ENV_VAR_KEY" == "" ] || [ "$ENV_VAR_VALUE" == "" ]; do
        if [ "${GH_ACTION^^}" == "Y" ]; then
            outputError "Key and value cannot be empty. Please try again."
            writeLog "Empty environment variable key or value entered (GH_ACTION mode)"
            exit 15
        fi
        echo "⚠️  Key or value cannot be empty. Try again."
        writeLog "Empty environment variable key or value entered"
        read -p "🔑 Enter Environment Variable Key →  " ENV_VAR_KEY
        read -p "🔑 Enter Environment Variable Value →  " ENV_VAR_VALUE
    done

    echo "$ENV_VAR_KEY=$ENV_VAR_VALUE" >> $TEMP_ENV_FILE_PATH

    read -p "🔑 Do you want to enter another Environment Variable? (y/n) →  " ENTER_ANOTHER_ENV

    while [ "${ENTER_ANOTHER_ENV^^}" == "Y" ]; do
        gatherEnvVars "$TEMP_ENV_FILE_PATH"
    done
}

if [ -z "$REQUIRE_ENV_VARS" ]; then
    read -p "🔑 Does your application require environment variables? (y/n) →  " REQUIRE_ENV_VARS
fi

while [ "${REQUIRE_ENV_VARS^^}" != "Y" ] && [ "${REQUIRE_ENV_VARS^^}" != "N" ] && [ "${REQUIRE_ENV_VARS^^}" != "" ]; do
    echo "⚠️ Invalid option. Please try again."
    writeLog "Invalid environment variables requirement option entered: $REQUIRE_ENV_VARS"
    read -p "🔑 Does your application require environment variables? (y/n) →  " REQUIRE_ENV_VARS
done

if [ "${GH_ACTION^^}" == "Y" ]; then
    if [ ! -z "$CONTAINER_ENV_VARS" ]; then
        REQUIRE_ENV_VARS="Y"
    fi
fi

if [ "${REQUIRE_ENV_VARS^^}" == "Y" ]; then
    # generate random temp .env folder to store all env files for different components
    RANDOM_NUM=$(shuf -i 100000-999999 -n 1)
    ENV_FOLDER="env_$RANDOM_NUM"
    ENV_FOLDER_PATH="/root/bin/env/$ENV_FOLDER"
    mkdir -p "$ENV_FOLDER_PATH"

    if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
        if [ ! -z "$CONTAINER_ENV_VARS" ]; then # Environment Variables
            if echo "$CONTAINER_ENV_VARS" | jq -e > /dev/null 2>&1; then #if exit status of jq is 0 (valid JSON) // success
                for key in $(echo "$CONTAINER_ENV_VARS" | jq -r 'keys[]'); do
                    gatherComponentDir "Enter the path of your component to enter environment variables" "$key"
                    ENV_FILE_NAME=$(echo "$COMPONENT_PATH" | tr '/' '_')
                    ENV_FILE_NAME="$ENV_FILE_NAME.txt"
                    ENV_FILE_PATH="/root/bin/env/$ENV_FOLDER/$ENV_FILE_NAME"
                    touch "$ENV_FILE_PATH"
                    echo "$CONTAINER_ENV_VARS" | jq -r --arg key "$key" '.[$key] | to_entries[] | "\(.key)=\(.value)"' > "$ENV_FILE_PATH"
                    addComponent "$key"
                done
            else
                if [ "${GH_ACTION^^}" == "Y" ]; then
                    outputError "Your \"CONTAINER_ENV_VARS\" is not valid JSON. Please re-format and try again."
                    writeLog "Invalid JSON in CONTAINER_ENV_VARS (GH_ACTION mode)"
                    exit 16
                fi
                echo "⚠️  Your \"CONTAINER_ENV_VARS\" is not valid JSON. Please re-format and try again."
                writeLog "Invalid JSON in CONTAINER_ENV_VARS"
                exit 16
            fi
        else # No Environment Variables
            gatherComponentDir "Enter the path of your component to enter environment variables"

            while [ "$COMPONENT_PATH" != "" ]; do
                addComponent "$COMPONENT_PATH"
                ENV_FILE_NAME=$(echo "$COMPONENT_PATH" | tr '/' '_')
                ENV_FILE="$ENV_FILE_NAME.txt"
                ENV_FILE_PATH="/root/bin/env/$ENV_FOLDER/$ENV_FILE"
                touch "$ENV_FILE_PATH"
                gatherEnvVars "$ENV_FILE_PATH"
                gatherComponentDir "Enter the path of your component to enter environment variables"
            done
        fi
    else # Single Component
        ENV_FILE="env_$RANDOM_NUM.txt"
        ENV_FILE_PATH="/root/bin/env/$ENV_FOLDER/$ENV_FILE"
        touch "$ENV_FILE_PATH"
        
        if [ ! -z "$CONTAINER_ENV_VARS" ]; then # Environment Variables
            if echo "$CONTAINER_ENV_VARS" | jq -e > /dev/null 2>&1; then #if exit status of jq is 0 (valid JSON) // success
                echo "$CONTAINER_ENV_VARS " | jq -r 'to_entries[] | "\(.key)=\(.value)"' > "$ENV_FILE_PATH" #k=v pairs
            else
                if [ "${GH_ACTION^^}" == "Y" ]; then
                    outputError "Your \"CONTAINER_ENV_VARS\" is not valid JSON. Please re-format and try again."
                    writeLog "Invalid JSON in CONTAINER_ENV_VARS for single component (GH_ACTION mode)"
                    exit 16
                fi
                echo "⚠️  Your \"CONTAINER_ENV_VARS\" is not valid JSON. Please re-format and try again."
                writeLog "Invalid JSON in CONTAINER_ENV_VARS for single component"
                exit 16
            fi
        else # No Environment Variables
             gatherEnvVars "$ENV_FILE_PATH"
        fi
    fi
fi