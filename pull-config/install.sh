#!/usr/bin/env bash

set -euo pipefail

# Installation script for pull-config
# This script copies configuration files into system directories

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing pull-config..."

# Copy cron job
echo "Installing cron job to /etc/cron.d/pull-config..."
install -m 644 "${SCRIPT_DIR}/etc/cron.d/pull-config" /etc/cron.d/pull-config

# Create instance configuration directory
echo "Creating /etc/pull-config.d/..."
mkdir -p /etc/pull-config.d

# Copy instance scripts
echo "Installing instance scripts to /etc/pull-config.d/..."
for script in "${SCRIPT_DIR}/etc/pull-config.d"/*; do
  if [[ -f "${script}" ]]; then
    instance=$(basename "${script}")
    echo "  - Installing ${instance} instance"
    install -m 755 "${script}" "/etc/pull-config.d/${instance}"
  fi
done

# Make sure the main binary is executable
echo "Setting executable permission on /opt/opensource-server/pull-config/bin/pull-config..."
chmod +x "${SCRIPT_DIR}/bin/pull-config"

echo ""
echo "Installation complete!"
echo ""
echo "Installed instances:"
for script in /etc/pull-config.d/*; do
  if [[ -f "${script}" && -x "${script}" ]]; then
    echo "  - $(basename "${script}")"
  fi
done
echo ""
echo "Instance scripts can be customized in /etc/pull-config.d/"
echo "Each instance runs independently via cron every minute using run-parts"
echo ""
echo "To add a new instance:"
echo "  1. Create an executable script in /etc/pull-config.d/<instance-name>"
echo "  2. Set required environment variables (CONF_FILE, CONF_URL)"
echo "  3. Call: exec /opt/opensource-server/pull-config/bin/pull-config"
echo ""
echo "To test an instance manually:"
echo "  sudo /etc/pull-config.d/nginx"


