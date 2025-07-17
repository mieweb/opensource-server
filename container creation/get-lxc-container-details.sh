#!/bin/bash
# Main Container Creation Script
# Modified July 17th, 2025 by Maxwell Klema
# ------------------------------------------

# Define color variables (works on both light and dark backgrounds)
RESET="\033[0m"
BOLD="\033[1m"
MAGENTA='\033[35m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}📦 MIE Container Creation Script ${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Authenticate User (Only Valid Users can Create Containers)

if [ -z "$PROXMOX_USERNAME" ]; then
	read -p  "Enter Proxmox Username →  " PROXMOX_USERNAME
fi

if [ -z "$PROXMOX_PASSWORD" ]; then
	read -sp "Enter Proxmox Password →  " PROXMOX_PASSWORD
	echo ""
fi

USER_AUTHENTICATED=$(node /root/bin/js/runner.js authenticateUser "$PROXMOX_USERNAME" "$PROXMOX_PASSWORD")
RETRIES=3

while [ $USER_AUTHENTICATED == 'false' ]; do
	if [ $RETRIES -gt 0 ]; then
		echo "❌ Authentication Failed. Try Again"
		read -p  "Enter Proxmox Username →  " PROXMOX_USERNAME
		read -sp "Enter Proxmox Password →  " PROXMOX_PASSWORD
		echo ""

		USER_AUTHENTICATED=$(node /root/bin/js/runner.js authenticateUser "$PROXMOX_USERNAME" "$PROXMOX_PASSWORD")
		RETRIES=$(($RETRIES-1))
	else
		echo "Too many incorrect attempts. Exiting..."
		exit 2
	fi
done

echo "🎉 Your proxmox account, $PROXMOX_USERNAME@pve, has been authenticated"

# Gather Container Hostname (hostname.opensource.mieweb.org)

if [ -z "$CONTAINER_NAME" ]; then
	read -p "Enter Application Name (One-Word) →  " CONTAINER_NAME
fi

CONTAINER_NAME="${CONTAINER_NAME,,}" #convert to lowercase
HOST_NAME_EXISTS=$(ssh root@10.15.20.69 "node /etc/nginx/checkHostnameRunner.js checkHostnameExists ${CONTAINER_NAME}")
HOST_NAME_RETRIES=10

while [[ $HOST_NAME_EXISTS == 'true' ]] || ! [[ "$CONTAINER_NAME" =~ ^[A-Za-z0-9-]+$ ]]; do
	if [ $HOST_NAME_RETRIES -gt 0 ]; then
		echo "Sorry! Either that name has already been registered or your hostname is ill-formatted. Try another name"
		read -p "Enter Application Name (One-Word) →  " CONTAINER_NAME
		HOST_NAME_EXISTS=$(ssh root@10.15.20.69 "node /etc/nginx/checkHostnameRunner.js checkHostnameExists ${CONTAINER_NAME}")
		HOST_NAME_RETRIES=$(($HOST_NAME_RETRIES-1))
		CONTAINER_NAME="${CONTAINER_NAME,,}"
	else
		echo "Too many incorrect attempts. Exiting..."
		exit 3
	fi
done

echo "✅ $CONTAINER_NAME is available"

# Gather Container Password
PASSWORD_RETRIES=10

if [ -z "$CONTAINER_PASSWORD" ]; then
	read -sp "Enter Container Password →  " CONTAINER_PASSWORD
	echo
	read -sp "Confirm Container Password →  " CONFIRM_PASSWORD
	echo

	while [[ "$CONFIRM_PASSWORD" != "$CONTAINER_PASSWORD" || ${#CONTAINER_PASSWORD} -lt 8 ]]; do
        	if [ $PASSWORD_RETRIES -gt 0 ]; then
				echo "Sorry, try again. Ensure passwords are at least 8 characters."
				read -sp "Enter Container Password →  " CONTAINER_PASSWORD
				echo
				read -sp "Confirm Container Password →  " CONFIRM_PASSWORD
				echo
				PASSWORD_RETRIES=$(($PASSWORD_RETRIES-1))
			else
				echo "Too many incorrect attempts. Exiting..."
				exit 4
			fi
	done
else
	CONFIRM_PASSWORD="$CONTAINER_PASSWORD"
	while [[ "$CONFIRM_PASSWORD" != "$CONTAINER_PASSWORD" || ${#CONTAINER_PASSWORD} -lt 8 ]]; do
        	if [ $PASSWORD_RETRIES -gt 0 ]; then
				echo "Sorry, try again. Ensure passwords are at least 8 characters."
				read -sp "Enter Container Password →  " CONTAINER_PASSWORD
				echo
				read -sp "Confirm Container Password →  " CONFIRM_PASSWORD
				echo
				PASSWORD_RETRIES=$(($PASSWORD_RETRIES-1))
			else
				echo "Too many incorrect attempts. Exiting..."
				exit 4
			fi
	done
fi

# Choose Linux Distribution

if [ -z "$LINUX_DISTRIBUTION" ]; then
	echo "🐧 Available Linux Distributions:"
	echo "1. Debian 12 (Bookworm)"
	echo "2. Rocky 9 "
	read -p "➡️ Choose a Linux Distribution (debian/rocky) →  " LINUX_DISTRIBUTION
fi

while [ "${LINUX_DISTRIBUTION,,}" != "debian" ] && [ "${LINUX_DISTRIBUTION,,}" != "rocky" ]; do
	echo "❌  Please choose a valid Linux Distribution."
	echo "1. Debian 12 (Bookworm)"
	echo "2. Rocky 9 "
	read -p "➡️  Choose a Linux Distribution (debian/rocky) →  " LINUX_DISTRIBUTION
done

LINUX_DISTRIBUTION=${LINUX_DISTRIBUTION,,}

# Attempt to detect public keys

echo -e "\n🔑 Attempting to Detect SSH Public Key..."

AUTHORIZED_KEYS="/root/.ssh/authorized_keys"
RANDOM_NUM=$(shuf -i 100000-999999 -n 1)
PUB_FILE="key_$RANDOM_NUM.pub"
TEMP_PUB_FILE="/root/bin/ssh/temp_pubs/$PUB_FILE" # in case two users are running this script at the same time, they do not overwrite each other's temp files
touch "$TEMP_PUB_FILE"
DETECT_PUBLIC_KEY=$(sudo /root/bin/ssh/detectPublicKey.sh "$SSH_KEY_FP" "$TEMP_PUB_FILE")
KEY_RETRIES=10

if [ "$DETECT_PUBLIC_KEY" == "Public key found for create-container" ]; then
	echo "🔐 Public Key Found!"
else
	echo "🔍 Could not detect Public Key"

	if [ -z "$PUBLIC_KEY" ]; then
		read -p "Enter Public Key (Allows Easy Access to Container) [OPTIONAL - LEAVE BLANK TO SKIP] →  " PUBLIC_KEY
	fi

	# Check if key is valid

	while [[ "$PUBLIC_KEY" != "" && $(echo "$PUBLIC_KEY" | ssh-keygen -l -f - 2>&1 | tr -d '\r') == "(stdin) is not a public key file." ]]; do
		if [ $KEY_RETRIES -gt 0 ]; then
			echo "❌ \"$PUBLIC_KEY\" is not a valid key. Enter either a valid key or leave blank to skip."
			read -p "Enter Public Key (Allows Easy Access to Container) [OPTIONAL - LEAVE BLANK TO SKIP] →  " PUBLIC_KEY	
			KEY_RETRIES=$(($KEY_RETRIES-1))
		else
			echo "Too many incorrect attempts. Exiting..."
			exit 5
		fi
	done

	if [ "$PUBLIC_KEY" != "" ]; then
		echo "$PUBLIC_KEY" > "$AUTHORIZED_KEYS" && systemctl restart ssh
		echo "$PUBLIC_KEY" > "$TEMP_PUB_FILE"
		sudo /root/bin/ssh/publicKeyAppendJumpHost.sh "$PUBLIC_KEY"
	fi
fi

# Get HTTP Port Container Listens On
HTTP_PORT_RETRIES=10

if [ -z "$HTTP_PORT" ]; then
        read -p "Enter HTTP Port for your container to listen on (80-60000) →  " HTTP_PORT
fi

while ! [[ "$HTTP_PORT" =~ ^[0-9]+$ ]] || [ "$HTTP_PORT" -lt 80 ] || [ "$HTTP_PORT" -gt 60000 ]; do
	if [ $HTTP_PORT_RETRIES -gt 0 ]; then
		echo "❌ Invalid HTTP Port. It must be a number between 80 and 60,000."
    	read -p "Enter HTTP Port for your container to listen on (80-60000) →  " HTTP_PORT
		HTTP_PORT_RETRIES=$(($HTTP_PORT_RETRIES-1))
	else
		echo "Too many incorrect attempts. Exiting..."
		exit 6
	fi
done

echo "✅ HTTP Port is set to $HTTP_PORT"

# Get any other protocols

protocol_duplicate() {
	PROTOCOL="$1"
	shift #remaining params are part of list
	LIST="$@"

	for item in $LIST; do
		if [[ "$item" == "$PROTOCOL" ]]; then
			return 0 # Protocol is a duplicate
		fi
	done
	return 1 # Protocol is not a duplicate
}

read -p "Does your Container require any protocols other than SSH and HTTP? (y/n) →  " USE_OTHER_PROTOCOLS
while [ "${USE_OTHER_PROTOCOLS^^}" != "Y" ] && [ "${USE_OTHER_PROTOCOLS^^}" != "N" ] && [ "${USER_OTHER_PROTOCOLS^^}" != "" ]; do
	echo "Please answer 'y' for yes or 'n' for no."
	read -p "Does your Container require any protocols other than SSH and HTTP? (y/n) →  " USE_OTHER_PROTOCOLS
done

RANDOM_NUM=$(shuf -i 100000-999999 -n 1)
PROTOCOL_BASE_FILE="protocol_list_$RANDOM_NUM.txt"
PROTOCOL_FILE="/root/bin/protocols/$PROTOCOL_BASE_FILE"
touch "$PROTOCOL_FILE"

if [ "${USE_OTHER_PROTOCOLS^^}" == "Y" ]; then
	LIST_PROTOCOLS=()
	read -p "Enter the protocol abbreviation (e.g, LDAP for Lightweight Directory Access Protocol). Type \"e\" to exit →  " PROTOCOL_NAME
	while [ "${PROTOCOL_NAME^^}" != "E" ]; do
		FOUND=0 #keep track if protocol was found
		while read line; do
			PROTOCOL_ABBRV=$(echo "$line" | awk '{print $1}')
			protocol_duplicate "$PROTOCOL_ABBRV" "${LIST_PROTOCOLS[@]}"
			IS_PROTOCOL_DUPLICATE=$?	
			if [[ "$PROTOCOL_ABBRV" == "${PROTOCOL_NAME^^}" && "$IS_PROTOCOL_DUPLICATE" -eq 1 ]]; then
				LIST_PROTOCOLS+=("$PROTOCOL_ABBRV")
				PROTOCOL_UNDRLYING_NAME=$(echo "$line" | awk '{print $3}')
				PROTOCOL_DEFAULT_PORT=$(echo "$line" | awk '{print $2}')
				echo "$PROTOCOL_ABBRV $PROTOCOL_UNDRLYING_NAME $PROTOCOL_DEFAULT_PORT" >> "$PROTOCOL_FILE"
				echo "✅ Protocol ${PROTOCOL_NAME^^} added to container."
				FOUND=1 #protocol was found
				break
			else
				echo "❌ Protocol ${PROTOCOL_NAME^^} was already added to your container. Please try again."
				FOUND=2 #protocol was a duplicate
				break
			fi
		done < <(cat "/root/bin/protocols/master_protocol_list.txt" | grep "^${PROTOCOL_NAME^^}") 

		if [ $FOUND -eq 0 ]; then #if no results found, let user know.
			echo "❌ Protocol ${PROTOCOL_NAME^^} not found. Please try again."
		fi

		read -p "Enter the protocol abbreviation (e.g, LDAP for Lightweight Directory Access Protocol). Type \"e\" to exit →  " PROTOCOL_NAME
	done
fi


# Attempt to deploy application on start.

if [ -z "$DEPLOY_ON_START" ]; then
	read -p "🚀 Do you want to deploy your project automatically? (y/n) →  " DEPLOY_ON_START
fi

while [ "${DEPLOY_ON_START^^}" != "Y" ] && [ "${DEPLOY_ON_START^^}" != "N" ] && [ "${DEPLOY_ON_START^^}" != "" ]; do
	echo "Please answer 'y' for yes or 'n' for no."
	read -p "🚀 Do you want to deploy your project automatically? (y/n) →  " DEPLOY_ON_START
done

if [ "${DEPLOY_ON_START^^}" == "Y" ]; then
	source /root/bin/deploy-application.sh
fi

# send public key, port mapping, env vars, and services to hypervisor

send_file_to_hypervisor() {
    local LOCAL_FILE="$1"
    local REMOTE_FOLDER="$2"
	if [ "$REMOTE_FOLDER" != "container-env-vars" ]; then
		if [ -s "$LOCAL_FILE" ]; then
        	sftp root@10.15.0.4 <<EOF > /dev/null
put $LOCAL_FILE /var/lib/vz/snippets/$REMOTE_FOLDER/
EOF
		fi
	else
		if [ -d "$LOCAL_FILE" ]; then
			sftp root@10.15.0.4 <<EOF > /dev/null
put -r $LOCAL_FILE /var/lib/vz/snippets/$REMOTE_FOLDER/
EOF
		else
			ENV_FOLDER="null"
		fi
    fi
}

send_file_to_hypervisor "$TEMP_PUB_FILE" "container-public-keys"
send_file_to_hypervisor "$PROTOCOL_FILE" "container-port-maps"
send_file_to_hypervisor "$ENV_FOLDER_PATH" "container-env-vars"
send_file_to_hypervisor "$TEMP_SERVICES_FILE_PATH" "container-services"

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${MAGENTA}🚀 Starting Container Creation...${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

ssh -t root@10.15.0.4 "bash -c '/var/lib/vz/snippets/clone-clxc.sh \
'\''$CONTAINER_NAME'\'' \
'\''$CONTAINER_PASSWORD'\'' \
'\''$HTTP_PORT'\'' \
'\''$PROXMOX_USERNAME'\'' \
'\''$PUB_FILE'\'' \
'\''$PROTOCOL_BASE_FILE'\'' \
'\''$DEPLOY_ON_START'\'' \
'\''$PROJECT_REPOSITORY'\'' \
'\''$PROJECT_BRANCH'\'' \
'\''$PROJECT_ROOT'\'' \
'\''$INSTALL_COMMAND'\'' \
'\''$BUILD_COMMAND'\'' \
'\''$START_COMMAND'\'' \
'\''$RUNTIME_LANGUAGE'\'' \
'\''$ENV_FOLDER'\'' \
'\''$SERVICES_FILE'\'' \
'\''$LINUX_DISTRIBUTION'\'' \
'\''$MULTI_COMPONENT'\'' 
'\''$ROOT_START_COMMAND'\'' '"


rm -rf "$PROTOCOL_FILE"
rm -rf "$TEMP_PUB_FILE"
rm -rf "$TEMP_SERVICES_FILE_PATH"
rm -rf "$ENV_FOLDER_PATH"

unset CONFIRM_PASSWORD
unset CONTAINER_PASSWORD
unset PUBLIC_KEY
