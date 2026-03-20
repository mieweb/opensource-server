#!/usr/bin/env bash
# wazuh-enroll.sh
#
# One-shot Wazuh agent enrollment script executed by wazuh-enroll.service on
# first boot. Uses /etc/machine-id as a stable, randomly-generated agent name
# to avoid the conflicting-agent-name problem that arises when using hostnames.
#
# If WAZUH_MANAGER is not set the script exits immediately without enrolling
# and without creating the sentinel file, so the service will try again on
# the next boot if the variable is later added via a container reconfigure.
#
# After a successful enrollment the enrollment password is deleted from
# /var/ossec/etc/authd.pass and purged from /etc/environment to limit the
# window during which a user with sudo could read it.

set -euo pipefail

# /etc/environment is populated by environment.service (Before=sysinit.target).
# Source it here so we can read the variables regardless of how systemd passes
# the environment to this unit.
set -a
# shellcheck source=/dev/null
[ -f /etc/environment ] && source /etc/environment
set +a

if [ -z "${WAZUH_MANAGER:-}" ]; then
    echo "WAZUH_MANAGER is not set — skipping Wazuh agent enrollment"
    exit 0
fi

AGENT_NAME=$(cat /etc/machine-id)
echo "Enrolling Wazuh agent '${AGENT_NAME}' with manager '${WAZUH_MANAGER}'"

# ---------------------------------------------------------------------------
# Add Wazuh apt repository
# ---------------------------------------------------------------------------
curl -fsSL https://packages.wazuh.com/key/GPG-KEY-WAZUH \
    | gpg --dearmor -o /usr/share/keyrings/wazuh.gpg

echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" \
    > /etc/apt/sources.list.d/wazuh.list

# Update only the Wazuh source list to avoid touching unrelated repositories
apt-get update \
    -o Dir::Etc::sourcelist="/etc/apt/sources.list.d/wazuh.list" \
    -o Dir::Etc::sourceparts="-" \
    -o APT::Get::List-Cleanup="0"

# ---------------------------------------------------------------------------
# Install the agent.
# The WAZUH_MANAGER and WAZUH_AGENT_NAME variables are consumed by the
# wazuh-agent dpkg post-install script to write ossec.conf automatically.
# ---------------------------------------------------------------------------
WAZUH_MANAGER="${WAZUH_MANAGER}" \
WAZUH_AGENT_NAME="${AGENT_NAME}" \
    apt-get install -y --no-install-recommends wazuh-agent

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
# Enable and start the agent (auto-enrollment on first start)
# ---------------------------------------------------------------------------
systemctl daemon-reload
systemctl enable wazuh-agent
systemctl start wazuh-agent

# ---------------------------------------------------------------------------
# Wait for successful enrollment (up to 60 s)
# ---------------------------------------------------------------------------
echo "Waiting for agent key exchange..."
enrolled=false
for i in $(seq 1 60); do
    if [ -s /var/ossec/etc/client.keys ]; then
        enrolled=true
        echo "Agent enrolled successfully (took ${i}s)"
        break
    fi
    sleep 1
done

if [ "$enrolled" = false ]; then
    echo "Warning: enrollment did not complete within 60 seconds" >&2
fi

# ---------------------------------------------------------------------------
# Security cleanup: remove enrollment credentials from disk so users with
# sudo on this container cannot retrieve the shared enrollment password.
# The agent key is now stored in client.keys; authd.pass is no longer needed.
# ---------------------------------------------------------------------------
if [ -f /var/ossec/etc/authd.pass ]; then
    rm -f /var/ossec/etc/authd.pass
    echo "Removed enrollment password from /var/ossec/etc/authd.pass"
fi

if [ -f /etc/environment ]; then
    sed -i '/^WAZUH_REGISTRATION_PASSWORD=/d' /etc/environment
    echo "Purged WAZUH_REGISTRATION_PASSWORD from /etc/environment"
fi

# Mark as enrolled so this service does not run again on subsequent boots.
touch /etc/wazuh-enrolled
echo "Wazuh enrollment complete"
