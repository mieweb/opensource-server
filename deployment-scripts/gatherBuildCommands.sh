#!/bin/bash
BUILD_COMMANDS_DICT={}

if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
    if [ ! -z "$BUILD_COMMAND" ]; then # Environment Variable Passed
        if echo "$BUILD_COMMAND" | jq -e > /dev/null 2>&1; then # Valid JSON
            for key in $(echo "$BUILD_COMMAND" | jq -r 'keys[]'); do
                gatherComponentDir "Enter the path of your component to enter the build command" "$key"
            done
        else
            echo "⚠️  Your \"BUILD_COMMANDS\" is not valid JSON. Please re-format and try again."
            exit 10
        fi
    else  # No Environment Variable Passed
        gatherComponentDir "Enter the path of your component to enter the build command"
        while [ "$COMPONENT_PATH" != "" ]; do
            read -p "🏗️  Enter the build command for \"$COMPONENT_PATH\" →  " B_COMMAND
            
            # Append Component:Build_Command k:v pair to map
            BUILD_COMMANDS_DICT=$(echo "$BUILD_COMMANDS_DICT" | jq --arg k "$COMPONENT_PATH" --arg v "$B_COMMAND" '. + {($k): $v}')
            gatherComponentDir "Enter the path of your component to enter the build command"
        done
        BUILD_COMMAND=$BUILD_COMMANDS_DICT
    fi
else
    if [ -z "$BUILD_COMMAND" ]; then
        read -p "🏗️  Enter the build command (Press Enter for no Build Command) →  " BUILD_COMMAND
    fi
fi

echo "BUILD_COMMAND: $BUILD_COMMAND"

