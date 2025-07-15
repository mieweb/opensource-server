#!/bin/bash

gatherRunTime() {
    COMPONENT_PATH="$1"

    if [ -z "${RUNTIME_LANGUAGE}" ] && [ "${MULTI_COMPONENT^^}" == "n" ]; then
        read -p "🖥️  Enter the underlying runtime environment for \"$COMPONENT_PATH\" (e.g., 'nodejs', 'python') →  " RUNTIME_LANGUAGE
    fi

    while [ "${RUNTIME_LANGUAGE^^}" != "NODEJS" ] && [ "${RUNTIME_LANGUAGE^^}" != "PYTHON" ]; do
        echo "⚠️  Sorry, that runtime environment is not yet supported. Only \"nodejs\" and \"python\" are currently supported."
        read -p "🖥️  Enter the underlying runtime environment for \"$COMPONENT_PATH\" (e.g., 'nodejs', 'python') →  " RUNTIME_LANGUAGE
    done
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
                removeFromList "$key"
            done
            if [ ${#UNIQUE_COMPONENTS_CLONE[@]} -gt 0 ]; then #if there are still components in the list, then not all runtimes were provided, so exit on error
                echo "⚠️ You did not provide runtime languages for these components: \"${UNIQUE_COMPONENTS_CLONE[@]}\"."
                exit 11
            fi
        else
            echo "⚠️  Your \"$RUNTIME_LANGUAGE\" is not valid JSON. Please re-format and try again."
            exit 10
        fi
    else # No Environment Variable Passed
        for CURRENT in "${UNIQUE_COMPONENTS[@]}"; do
            gatherRunTime "$CURRENT"
            RUNTIME_LANGUAGE_DICT=$(echo "$RUNTIME_LANGUAGE_DICT" | jq --arg k "$CURRENT" --arg v "$RUNTIME_LANGUAGE" '. + {($k): $v}')
        done
        RUNTIME_LANGUAGE=$RUNTIME_LANGUAGE_DICT
        echo "DICT: $RUNTIME_LANGUAGE_DICT"
    fi
else
    gatherRunTime "$PROJECT_REPOSITORY"
fi