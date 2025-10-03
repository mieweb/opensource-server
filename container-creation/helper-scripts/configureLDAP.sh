#!/bin/bash
# Script to connect a container to the LDAP server via SSSD
# Last Modified by Carter Myers on Aug 28th, 2025
# -----------------------------------------------------

run_pct_exec() {
    local ctid="$1"
    shift
    if [ "${AI_CONTAINER^^}" == "Y" ]; then
        # Use printf %q to safely quote all arguments for the remote shell
        local remote_cmd
        printf -v remote_cmd '%q ' "$@"
        ssh root@10.15.0.6 "pct exec $ctid -- $remote_cmd"
    else
        pct exec "$ctid" -- "$@"
    fi
}

run_pct() {
    # $@ = full pct command, e.g., clone, set, start, etc.
    if [ "${AI_CONTAINER^^}" == "Y" ]; then
        ssh root@10.15.0.6 "pct $*"
    else
        pct "$@"
    fi
}

# Curl Pown.sh script to install SSSD and configure LDAP 
run_pct_exec $CONTAINER_ID bash -c "
cd /root && \
curl -O https://raw.githubusercontent.com/anishapant21/pown.sh/main/pown.sh > /dev/null 2>&1 && \
chmod +x pown.sh
"

# Copy .env file to container (safe for SSH / AI_CONTAINER)
ENV_FILE="/var/lib/vz/snippets/.env"
ENV_CONTENT=$(<"$ENV_FILE" sed 's/["\$`]/\\&/g')  # Escape special characters
run_pct_exec $CONTAINER_ID bash -c "printf '%s\n' \"$ENV_CONTENT\" > /root/.env"

# Run the pown.sh script to configure LDAP
run_pct_exec $CONTAINER_ID bash -c "cd /root && ./pown.sh" > /dev/null 2>&1

# Remove ldap_tls_cert from /etc/sssd/sssd.conf
run_pct_exec $CONTAINER_ID sed -i '/ldap_tls_cacert/d' /etc/sssd/sssd.conf > /dev/null 2>&1

# Add TLS_REQCERT to never in ROCKY
if [ "${LINUX_DISTRO^^}" == "ROCKY" ]; then
    run_pct_exec $CONTAINER_ID bash -c "echo 'TLS_REQCERT never' >> /etc/openldap/ldap.conf" > /dev/null 2>&1
    run_pct_exec $CONTAINER_ID bash -c "authselect select sssd --force" > /dev/null 2>&1
    run_pct_exec $CONTAINER_ID bash -c "systemctl restart sssd" > /dev/null 2>&1
fi
