#!/bin/bash
# Wazuh Registration Script to register an agent with the Wazuh manager
# Last Modified on August 6th, 2025 by Maxwell Klema
# -------------------------------------------------


KEY=$(node /var/lib/vz/snippets/Wazuh/runner.js addAgent "$CONTAINER_NAME" "$CONTAINER_IP" | sed -n '2p')
MANAGER_IP="10.15.173.19"

if [ "$KEY" == "fail" ]; then
    echo "Failed to register agent with Wazuh manager."
    exit 1
fi

# Install all necessary dependencies and register the agent to the manager

pct enter "$CONTAINER_ID" -- <<EOF 
curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import && chmod 644 /usr/share/keyrings/wazuh.gpg && \
echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" | tee -a /etc/apt/sources.list.d/wazuh.list && \
apt-get update -y && \
apt-get install wazuh-agent -y && \
echo y | /var/ossec/bin/manage_agents -i "$KEY" && \
sed -i "s/MANAGER_IP/$MANAGER_IP/" /var/ossec/etc/ossec.conf && \
systemctl enable wazuh-agent  && \
systemctl restart wazuh-agent
EOF