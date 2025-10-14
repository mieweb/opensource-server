#!/bin/bash

# VERSIONS_DICT={}

# gatherRunTime() {
#     COMPONENT_PATH="$1"

#     if [ -z "${RUNTIME_LANGUAGE}" ] || [ "$RT_ENV_VAR" != "true" ]; then
#         read -p "🖥️  Enter the underlying runtime environment for \"$COMPONENT_PATH\" (e.g., 'nodejs', 'python') →  " RUNTIME_LANGUAGE
#     fi

#     RUNTIME_LANGUAGE_REGEX="^(python|nodejs)(@([0-9]+(\.[0-9]+){0,2}))?$"

#     while [[ ! ${RUNTIME_LANGUAGE,,} =~ $RUNTIME_LANGUAGE_REGEX ]]; do
#         echo "⚠️  Sorry, that runtime environment is not yet supported. Only \"nodejs\" and \"python\" are currently supported."
#         # writeLog "Unsupported runtime environment entered: $RUNTIME_LANGUAGE for component: $COMPONENT_PATH"
#         if [ "${GH_ACTION^^}" == "Y" ]; then
#             outputError "⚠️  Sorry, that runtime environment is not yet supported. Only \"nodejs\" and \"python\" are currently supported."
#             # writeLog "Unsupported runtime environment entered: $RUNTIME_LANGUAGE (GH_ACTION mode)"
#             exit 17
#         fi
#         read -p "🖥️  Enter the underlying runtime environment for \"$COMPONENT_PATH\" (e.g., 'nodejs', 'python') →  " RUNTIME_LANGUAGE
#     done

#     # Scrape runtime version
#     if [[ "${RUNTIME_LANGUAGE,,}" == *"@"* ]]; then
#         if [ "${MULTI_COMPONENT^^}" == "Y" ]; then
#             RUNTIME_VERSION=$(echo "${RUNTIME_LANGUAGE,,}" | sed -E 's/.*@([0-9]+(\.[0-9]+){0,2}).*/\1/')
#             UPDATED_VERSIONS_DICT=$(echo "$VERSIONS_DICT" | jq --arg k "$COMPONENT_PATH" --arg v "$RUNTIME_VERSION" '. + {($k): $v}')
#             VERSIONS_DICT=$UPDATED_VERSIONS_DICT
#         else
#             RUNTIME_VERSION=$(echo "${RUNTIME_LANGUAGE,,}" | sed -E 's/.*@([0-9]+(\.[0-9]+){0,2}).*/\1/')
#             UPDATED_VERSIONS_DICT=$(echo "$VERSIONS_DICT" | jq --arg k "default" --arg v "$RUNTIME_VERSION" '. + {($k): $v}')
#             VERSIONS_DICT=$UPDATED_VERSIONS_DICT
#         fi
#     fi
#     RUNTIME_LANGUAGE=$(echo "${RUNTIME_LANGUAGE,,}" | sed -E 's/@.*//')
# }

# gatherRunTime "test"

RUNTIME_LANGUAGE='{"frontend": "nodejs", "backend": "python@3.10"}'
echo "$RUNTIME_LANGUAGE"
RUNTIME_LANGUAGE=$(echo "$RUNTIME_LANGUAGE" \
  | jq -c '.frontend = "nodejs@3"')
echo "$RUNTIME_LANGUAGE"
