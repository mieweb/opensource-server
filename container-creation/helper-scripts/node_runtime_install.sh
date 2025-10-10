#!/bin/bash
# Script to install a specific Node.js runtime version
# Last Modified by Maxwell Klema on August 18th, 2025
# ----------------------------------------------------------

echo "⏳ installing Node.js runtime version $MAJOR_VERSION"
MAJOR_VERSION=$1

pct enter "$CONTAINER_ID" -- <<EOF > /dev/null
$PACKAGE_MANAGER remove nodejs && \
curl -fsSL https://deb.nodesource.com/setup_$MAJOR_VERSION.x | sudo -E bash - && \
$PACKAGE_MANAGER install -y nodejs
EOF