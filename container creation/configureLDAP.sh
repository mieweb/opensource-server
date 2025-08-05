#!/bin/bash
# Script to connect a container to the LDAP server via SSSD
# Last Modified by Maxwell Klema on July 29th, 2025
# -----------------------------------------------------

# Curl Pown.sh script to install SSSD and configure LDAP
pct enter $CONTAINER_ID <<EOF
cd /root && \
curl -O https://raw.githubusercontent.com/anishapant21/pown.sh/main/pown.sh > /dev/null 2>&1 && \
chmod +x pown.sh
EOF

# Copy .env file to container
ENV_FILE="/var/lib/vz/snippets/.env"
pct enter $CONTAINER_ID <<EOF
touch /root/.env && \
cat <<EOT > /root/.env
$(cat "$ENV_FILE")
EOT
EOF

# Run the pown.sh script to configure LDAP
pct exec $CONTAINER_ID -- bash -c "cd /root && ./pown.sh" > /dev/null 2>&1

# remove ldap_tls_cert from /etc/sssd/sssd.conf
pct exec $CONTAINER_ID -- sed -i '/ldap_tls_cacert/d' /etc/sssd/sssd.conf > /dev/null 2>&1

# Add TLS_REQCERT to never in ROCKY

if [ "${LINUX_DISTRO^^}" == "ROCKY" ]; then
    pct exec $CONTAINER_ID -- bash -c "echo 'TLS_REQCERT never' >> /etc/openldap/ldap.conf" > /dev/null 2>&1
    pct exec $CONTAINER_ID -- bash -c "authselect select sssd --force" > /dev/null 2>&1
    pct exec $CONTAINER_ID -- bash -c "systemctl restart sssd" > /dev/null 2>&1
fi
