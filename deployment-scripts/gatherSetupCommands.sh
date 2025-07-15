#!/bin/bash
# This function gathers start up commands, such as build, install, and start, for both single and multiple component applications
# Last Modified by Maxwell Klema on July 15th, 2025
# ---------------------------------------------

gatherSetupCommands() {

    TYPE="$1"
    PROMPT="$2"
    TYPE_COMMAND="${TYPE}_COMMAND"
    TYPE_COMMAND="${!TYPE_COMMAND}" # get value stored by TYPE_COMMAND
    declare "COMMANDS_DICT={}"

    if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
        if [ ! -z "$TYPE_COMMAND" ]; then # Environment Variable Passed
            if echo "$TYPE_COMMAND" | jq -e > /dev/null 2>&1; then # Valid JSON
                for key in $(echo "$TYPE_COMMAND" | jq -r 'keys[]'); do
                    gatherComponentDir "Enter the path of your component to enter the ${TYPE,,} command" "$key"
                    addComponent "$key"
                done
            else
                echo "⚠️  Your \"$TYPE_COMMAND\" is not valid JSON. Please re-format and try again."
                exit 10
            fi
        else  # No Environment Variable Passed
            gatherComponentDir "Enter the path of your component to enter the ${TYPE,,} command"
            while [ "$COMPONENT_PATH" != "" ]; do
                addComponent "$key"
                read -p "$PROMPT" COMMAND
                
                # Append Component:Command k:v pair to map
                COMMANDS_DICT=$(echo "$COMMANDS_DICT" | jq --arg k "$COMPONENT_PATH" --arg v "$COMMAND" '. + {($k): $v}')
                gatherComponentDir "Enter the path of your component to enter the ${TYPE,,} command"
            done
            TYPE_COMMAND=$COMMANDS_DICT
        fi
    else
        if [ -z "$TYPE_COMMAND" ]; then
            read -p "$PROMPT" TYPE_COMMAND
        fi
    fi

    # Write to correct command variable
    if [ "$TYPE" == "BUILD" ]; then
        BUILD_COMMAND=$TYPE_COMMAND
    elif [ "$TYPE" == "INSTALL" ]; then
        INSTALL_COMMAND=$TYPE_COMMAND
    else
        START_COMMAND=$TYPE_COMMAND
    fi
}