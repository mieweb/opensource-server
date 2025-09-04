SERVICE_MAP="/root/bin/services/service_map_$LINUX_DISTRIBUTION.json"
APPENDED_SERVICES=()

# Helper function to check if a user has added the same service twice
serviceExists() {
    SERVICE="$1"
    for CURRENT in "${APPENDED_SERVICES[@]}"; do
        if [ "${SERVICE,,}" == "${CURRENT,,}" ]; then
            return 0
        fi
    done
    return 1
}

processService() {
    local SERVICE="$1"
    local MODE="$2" # "batch" or "single"

    SERVICE_IN_MAP=$(jq -r --arg key "${SERVICE,,}" '.[$key] // empty' "$SERVICE_MAP")
    if serviceExists "$SERVICE"; then
        if [ "$MODE" = "batch" ]; then
            return 0 # skip to next in batch mode
        else
            echo "⚠️  You already added \"$SERVICE\" as a service. Please try again."
            writeLog "Duplicate service attempted: $SERVICE"
            return 0
        fi
    elif [ "${SERVICE^^}" != "C" ] && [ "${SERVICE^^}" != "" ] && [ -n "$SERVICE_IN_MAP" ]; then
        jq -r --arg key "${SERVICE,,}" '.[$key][]' "$SERVICE_MAP" >> "$TEMP_SERVICES_FILE_PATH"
        echo "sudo systemctl daemon-reload" >> "$TEMP_SERVICES_FILE_PATH"
        echo "✅ ${SERVICE^^} added to your container."
        APPENDED_SERVICES+=("${SERVICE^^}")
    elif [ "${SERVICE^^}" == "C" ]; then
        appendCustomService
    elif [ "${SERVICE^^}" != "" ]; then
        if [ "${GH_ACTION^^}" == "Y" ]; then
            outputError "⚠️  Service \"$SERVICE\" does not exist."
            writeLog "Invalid service entered: $SERVICE (GH_ACTION mode)"
            exit 20
        fi
        echo "⚠️  Service \"$SERVICE\" does not exist."
        writeLog "Invalid service entered: $SERVICE"
        [ "$MODE" = "batch" ] && exit 20
    fi
}

# Helper function to append a new service to a container
appendService() {
    if [ ! -z "$SERVICES" ]; then
        for SERVICE in $(echo "$SERVICES" | jq -r '.[]'); do
            processService "$SERVICE" "batch"
        done
    else
        read -p "➡️  Enter the name of a service to add to your container or type \"C\" to set up a custom service installation (Enter to exit) →  " SERVICE
        processService "$SERVICE" "single"
    fi
}

appendCustomService() {
    # If there is an env variable for custom services, iterate through each command and append it to temporary services file
    if [ ! -z "$CUSTOM_SERVICES" ]; then
        echo "$CUSTOM_SERVICES" | jq -c -r '.[]' | while read -r CUSTOM_SERVICE; do
            echo "$CUSTOM_SERVICE" | jq -c -r '.[]' | while read -r CUSTOM_SERVICE_COMMAND; do
                if [ ! -z "$CUSTOM_SERVICE_COMMAND" ]; then
                    echo "$CUSTOM_SERVICE_COMMAND" >> "$TEMP_SERVICES_FILE_PATH"
                else
                    if [ "${GH_ACTION^^}" == "Y" ]; then
                        outputError "⚠️  Custom Service Installation Command cannot be empty in \"$CUSTOM_SERVICE\"."
                        writeLog "Empty custom service command in: $CUSTOM_SERVICE (GH_ACTION mode)"
                        exit 21
                    fi
                    echo "⚠️  Command cannot be empty."
                    writeLog "Empty custom service command in: $CUSTOM_SERVICE"
                    exit 21;
                fi
            done
        done
        echo "✅ Custom Services appended."
    else
        echo "🛎️  Configuring Custom Service Installation. For each prompt, enter a command that is a part of the installation process for your service on Debian Bookworm. Do not forget to enable and start the service at the end. Once you have entered all of your commands, press enter to continue"
        COMMAND_NUM=1
        read -p "➡️  Enter Command $COMMAND_NUM: " CUSTOM_COMMAND

        echo "$CUSTOM_COMMAND" >> "$TEMP_SERVICES_FILE_PATH"

        while [ "${CUSTOM_COMMAND^^}" != "" ]; do
            ((COMMAND_NUM++))
            read -p "➡️  Enter Command $COMMAND_NUM: " CUSTOM_COMMAND
            echo "$CUSTOM_COMMAND" >> "$TEMP_SERVICES_FILE_PATH"
        done
    fi
}

# Helper function to see if a user wants to set up a custom service
setUpService() {
    read -p "🛎️  Do you wish to set up a custom service installation? (y/n) " SETUP_CUSTOM_SERVICE_INSTALLATION
    while [ "${SETUP_CUSTOM_SERVICE_INSTALLATION^^}" != "Y" ] && [ "${SETUP_CUSTOM_SERVICE_INSTALLATION^^}" != "N" ] && [ "${SETUP_CUSTOM_SERVICE_INSTALLATION^^}" != "" ]; do
        if [ "${GH_ACTION^^}" == "Y" ]; then
            outputError "⚠️  Invalid custom service installation option. Please try again."
            writeLog "Invalid custom service installation option entered: $SETUP_CUSTOM_SERVICE_INSTALLATION (GH_ACTION mode)"
            exit 22
        fi
        echo "⚠️  Invalid option. Please try again."
        writeLog "Invalid custom service installation option entered: $SETUP_CUSTOM_SERVICE_INSTALLATION"
        read -p "🛎️  Do you wish to set up a custom service installation? (y/n) " SETUP_CUSTOM_SERVICE_INSTALLATION
    done
}

if [ -z "$REQUIRE_SERVICES" ]; then
    read -p "🛎️  Does your application require special services (i.e. Docker, MongoDB, etc.) to run on the container? (y/n) →  " REQUIRE_SERVICES
fi

while [ "${REQUIRE_SERVICES^^}" != "Y" ] && [ "${REQUIRE_SERVICES^^}" != "N" ] && [ "${REQUIRE_SERVICES^^}" != "" ]; do
    echo "⚠️  Invalid option. Please try again."
    writeLog "Invalid service requirement option entered: $REQUIRE_SERVICES"
    read -p "🛎️  Does your application require special services (i.e. Docker, MongoDB, etc.) to run on the container? (y/n) →  " REQUIRE_SERVICES
done

if [ "${GH_ACTION^^}" == "Y" ]; then
    if [ ! -z "$SERVICES" ] || [ ! -z "$CUSTOM_SERVICES" ]; then
        REQUIRE_SERVICES="Y"
    fi
fi

if [ "${REQUIRE_SERVICES^^}" == "Y" ]; then
    
    # Generate random (temporary) file to store install commands for needed services 
    RANDOM_NUM=$(shuf -i 100000-999999 -n 1)
    SERVICES_FILE="services_$RANDOM_NUM.txt"
    TEMP_SERVICES_FILE_PATH="/root/bin/services/$SERVICES_FILE"
    touch "$TEMP_SERVICES_FILE_PATH"

    appendService
    while [ "${SERVICE^^}" != "" ] || [ ! -z "$SERVICES" ]; do
        if [ -z "$SERVICES" ]; then
            appendService
        else
            if [ ! -z "$CUSTOM_SERVICES" ]; then # assumes both services and custom services passed as ENV vars
                appendCustomService
            else # custom services not passed as ENV var, so must prompt the user for their custom services
                setUpService
                while [ "${SETUP_CUSTOM_SERVICE_INSTALLATION^^}" == "Y" ]; do
                    appendCustomService
                    setUpService
                done
            fi
            break
        fi
    done
fi

# Used for updating container services in GH Actions

UPDATING_CONTAINER="$1"
if [ "$UPDATING_CONTAINER" == "true" ]; then
    cat "$TEMP_SERVICES_FILE_PATH"
    rm -rf "$TEMP_SERVICES_FILE_PATH"
fi