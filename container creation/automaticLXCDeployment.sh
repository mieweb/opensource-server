#!/bin/bash
# Automation Script for attempting to automatically deploy projects and services on a container
# Last Modifided by Maxwell Klema on July 10th, 2025
# -----------------------------------------------------

echo "🚀  Attempting Automatic Deployment"

REPO_BASE_NAME=$(basename -s .git "$PROJECT_REPOSITORY")

# Clone github repository from correct branch

pct enter $NEXT_ID <<EOF
cd /root && \
git clone --branch $PROJECT_BRANCH --single-branch $PROJECT_REPOSITORY
EOF

# Copy over ENV variables
ENV_VARS=$(cat /var/lib/vz/snippets/container-env-vars/$ENV_BASE_FILE)
pct enter $NEXT_ID <<EOF
cd /root/$REPO_BASE_NAME/ && cd $PROJECT_ROOT && echo "$ENV_VARS" > .env
EOF

# Install correct runtime and project dependencies
if [ "${RUNTIME_LANGUAGE^^}" == "NODEJS" ]; then
pct enter $NEXT_ID <<EOF
sudo apt-get update -y && \
sudo apt install -y nodejs && sudo apt install -y npm && \
npm install -g pm2 && \
cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && sudo $INSTALL_COMMAND
EOF
fi

# Iterate over each service installation command
if [ -f "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE" ]; then
while read line; do
	pct exec $NEXT_ID -- bash -c "$line"
done < "/var/lib/vz/snippets/container-services/$SERVICES_BASE_FILE"
fi

# Build Project (If Needed) and Start it
if (( $NEXT_ID % 2 == 1 )); then
if [ "$BUILD_COMMAND" == "" ]; then
pct exec $NEXT_ID -- bash -c "export PATH=\$PATH:/usr/local/bin && cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && pm2 start bash -- -c '$START_COMMAND'"
else
pct enter $NEXT_ID <<EOF
cd /root/$REPO_BASE_NAME/$PROJECT_ROOT && \
export PATH=\$PATH:/usr/local/bin && \
$BUILD_COMMAND && pm2 start bash -- -c '$START_COMMAND'
EOF
fi
fi
