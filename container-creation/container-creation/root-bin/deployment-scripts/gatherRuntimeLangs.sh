#!/bin/bash

# Keep track of the runtime languages and versions for each component
VERSIONS_DICT={}

gatherRunTime() {
    COMPONENT_PATH="$1"

    if [ -z "${RUNTIME_LANGUAGE}" ] || [ "$RT_ENV_VAR" != "true" ]; then
        read -p "🖥️  Enter the underlying runtime environment for \"$COMPONENT_PATH\" (e.g., 'nodejs', 'python') →  " RUNTIME_LANGUAGE
    fi

    RUNTIME_LANGUAGE_REGEX="^(python|nodejs)(@([0-9]+(\.[0-9]+){0,2}))?$"

    while [[ ! ${RUNTIME_LANGUAGE,,} =~ $RUNTIME_LANGUAGE_REGEX ]]; do
        echo "⚠️  Sorry, that runtime environment is not yet supported. Only \"nodejs\" and \"python\" are currently supported."
        writeLog "Unsupported runtime environment entered: $RUNTIME_LANGUAGE for component: $COMPONENT_PATH"
        if [ "${GH_ACTION^^}" == "Y" ]; then
            exit 17
        fi
        read -p "🖥️  Enter the underlying runtime environment for \"$COMPONENT_PATH\" (e.g., 'nodejs', 'python') →  " RUNTIME_LANGUAGE
    done

    # Scrape runtime version
    if [[ "${RUNTIME_LANGUAGE,,}" == *"@"* ]]; then
        if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
            RUNTIME_VERSION=$(echo "${RUNTIME_LANGUAGE,,}" | sed -E 's/.*@([0-9]+(\.[0-9]+){0,2}).*/\1/')
            UPDATED_VERSIONS_DICT=$(echo "$VERSIONS_DICT" | jq --arg k "$COMPONENT_PATH" --arg v "$RUNTIME_VERSION" '. + {($k): $v}')
            VERSIONS_DICT=$UPDATED_VERSIONS_DICT
        else
            RUNTIME_VERSION=$(echo "${RUNTIME_LANGUAGE,,}" | sed -E 's/.*@([0-9]+(\.[0-9]+){0,2}).*/\1/')
            UPDATED_VERSIONS_DICT=$(echo "$VERSIONS_DICT" | jq --arg k "default" --arg v "$RUNTIME_VERSION" '. + {($k): $v}')
            VERSIONS_DICT=$UPDATED_VERSIONS_DICT
        fi
    fi
    RUNTIME_LANGUAGE=$(echo "${RUNTIME_LANGUAGE,,}" | sed -E 's/@.*//')
}

# Helper function to remove an item from a list
removeFromList() {
    ITEM_TO_REMOVE="$1"
    NEW_LIST=()
    for ITEM in "${UNIQUE_COMPONENTS_CLONE[@]}"; do
        if [ "$ITEM" != "$ITEM_TO_REMOVE" ]; then
            NEW_LIST+=("$ITEM")
        fi
    done
    UNIQUE_COMPONENTS_CLONE=("${NEW_LIST[@]}")
}

UNIQUE_COMPONENTS_CLONE=("${UNIQUE_COMPONENTS[@]}")
RUNTIME_LANGUAGE_DICT={}


if [ "${MULTI_COMPONENT^^}" == 'Y' ]; then
    if [ ! -z "$RUNTIME_LANGUAGE" ]; then # Environment Variable Passed
        if echo "$RUNTIME_LANGUAGE" | jq -e > /dev/null 2>&1; then # Valid JSON
            for key in $(echo "$RUNTIME_LANGUAGE" | jq -r 'keys[]'); do
                RUNTIME_LANGUAGE_REGEX="^(python|nodejs)(@([0-9]+(\.[0-9]+){0,2}))?$"
                COMPONENT_RUNTIME_LANGUAGE=$(echo "$RUNTIME_LANGUAGE" | jq -r --arg key "$key" '.[$key]')
                while [[ ! ${COMPONENT_RUNTIME_LANGUAGE,,} =~ $RUNTIME_LANGUAGE_REGEX ]]; do
                    outputError "⚠️  Sorry, that runtime environment is not yet supported. Only \"nodejs\" and \"python\" are currently supported."
                    writeLog "Unsupported runtime environment entered: $COMPONENT_RUNTIME_LANGUAGE for component: $COMPONENT_PATH (GH_ACTION mode)"
                    if [ "${GH_ACTION^^}" == "Y" ]; then
                        exit 17
                    fi
                    read -p "🖥️  Enter the underlying runtime environment for \"$COMPONENT_PATH\" (e.g., 'nodejs', 'python') →  " COMPONENT_RUNTIME_LANGUAGE
                done

                # Scrape runtime version
                if [[ "${COMPONENT_RUNTIME_LANGUAGE,,}" == *"@"* ]]; then
                    RUNTIME_VERSION=$(echo "${RUNTIME_LANGUAGE,,}" | sed -E 's/.*@([0-9]+(\.[0-9]+){0,2}).*/\1/')
                    UPDATED_VERSIONS_DICT=$(echo "$VERSIONS_DICT" | jq --arg k "$key" --arg v "$RUNTIME_VERSION" '. + {($k): $v}')
                    VERSIONS_DICT=$UPDATED_VERSIONS_DICT
                fi
                COMPONENT_RUNTIME_LANGUAGE=$(echo "${COMPONENT_RUNTIME_LANGUAGE,,}" | sed -E 's/@.*//')
                RUNTIME_LANGUAGE=$(echo "$RUNTIME_LANGUAGE" \
                  | jq -c --arg k "$key" --arg v "$COMPONENT_RUNTIME_LANGUAGE" '.[$k] = $v')

                removeFromList "$key"

            done
            if [ ${#UNIQUE_COMPONENTS_CLONE[@]} -gt 0 ]; then #if there are still components in the list, then not all runtimes were provided, so exit on error
                echo "⚠️ You did not provide runtime languages for these components: \"${UNIQUE_COMPONENTS_CLONE[@]}\"."
                writeLog "Missing runtime languages for components: ${UNIQUE_COMPONENTS_CLONE[@]}"
                exit 18
            fi
        else
            echo "⚠️  Your \"$RUNTIME_LANGUAGE\" is not valid JSON. Please re-format and try again."
            writeLog "Invalid JSON in RUNTIME_LANGUAGE"
            exit 16
        fi
    else # No Environment Variable Passed
        for CURRENT in "${UNIQUE_COMPONENTS[@]}"; do
            gatherRunTime "$CURRENT"
            RUNTIME_LANGUAGE_DICT=$(echo "$RUNTIME_LANGUAGE_DICT" | jq --arg k "$CURRENT" --arg v "$RUNTIME_LANGUAGE" '. + {($k): $v}')
        done
        RUNTIME_LANGUAGE=$RUNTIME_LANGUAGE_DICT
    fi
else
    if [ ! -z "$RUNTIME_LANGUAGE" ]; then
        RT_ENV_VAR="true"
    fi
    gatherRunTime "$PROJECT_REPOSITORY"
fi
