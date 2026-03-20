#!/usr/bin/env bash
# wazuh-enroll.sh
#
# One-shot Wazuh agent enrollment script executed by wazuh-enroll.service on
# first boot. The wazuh-agent package is pre-installed in the image; this
# script only configures ossec.conf, writes the optional enrollment password,
# and starts the agent.
#
# Uses /etc/machine-id as a stable agent name to avoid the conflicting-agent-
# name problem that arises when containers share a hostname.
#
# If WAZUH_MANAGER is empty or unset, the script exits 0 so the one-shot
# service is considered successful but does nothing. The service will not
# re-run because ConditionPathExists=!/var/ossec/etc/client.keys only
# triggers when the agent has never enrolled.

set -euo pipefail

if [ -z "${WAZUH_MANAGER:-}" ]; then
    echo "WAZUH_MANAGER is not set — skipping Wazuh agent enrollment"
    exit 0
fi

AGENT_NAME=$(cat /etc/machine-id)
echo "Enrolling Wazuh agent '${AGENT_NAME}' with manager '${WAZUH_MANAGER}'"

# ---------------------------------------------------------------------------
# Write ossec.conf with the manager address and agent name.
# The dpkg postinst did not have WAZUH_MANAGER at install time (image build),
# so we write the config now.
# ---------------------------------------------------------------------------
cat > /var/ossec/etc/ossec.conf <<EOF
<ossec_config>
  <client>
    <server>
      <address>${WAZUH_MANAGER}</address>
    </server>
  </client>
</ossec_config>
EOF
chmod 640 /var/ossec/etc/ossec.conf
chown root:wazuh /var/ossec/etc/ossec.conf

# ---------------------------------------------------------------------------
# Enrollment password (optional)
# ---------------------------------------------------------------------------
if [ -n "${WAZUH_REGISTRATION_PASSWORD:-}" ]; then
    echo "${WAZUH_REGISTRATION_PASSWORD}" > /var/ossec/etc/authd.pass
    chmod 640 /var/ossec/etc/authd.pass
    chown root:wazuh /var/ossec/etc/authd.pass
    echo "Wrote enrollment password to /var/ossec/etc/authd.pass"
fi

# ---------------------------------------------------------------------------
# Start the agent (auto-enrollment on first start)
# ---------------------------------------------------------------------------
systemctl start wazuh-agent

# ---------------------------------------------------------------------------
# Wait for successful enrollment (up to 60 s)
# ---------------------------------------------------------------------------
echo "Waiting for agent key exchange..."
for i in $(seq 1 60); do
    if [ -s /var/ossec/etc/client.keys ]; then
        echo "Agent enrolled successfully (took ${i}s)"
        exit 0
    fi
    sleep 1
done

echo "Warning: enrollment did not complete within 60 seconds" >&2
