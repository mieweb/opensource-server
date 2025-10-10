#!/bin/bash
# Script to connect a container to the LDAP server via SSSD
# Last Modified by Maxwell Klema, updated October 3rd 2025 by Carter Myers
# -----------------------------------------------------

# === Resolve target hypervisor for AI containers ===
case "${AI_CONTAINER^^}" in
  PHOENIX)
    TARGET_HYPERVISOR="10.15.0.4"
    ;;
  FORTWAYNE)
    TARGET_HYPERVISOR="10.250.0.2"
    ;;
  N|"")
    TARGET_HYPERVISOR=""
    ;;
  *)
    echo "❌ Invalid AI_CONTAINER value: $AI_CONTAINER" >&2
    exit 1
    ;;
esac

# === Wrappers for pct commands ===
run_pct_exec() {
    local ctid="$1"
    shift
    if [ -n "$TARGET_HYPERVISOR" ]; then
        # Safe quoting for remote execution
        local remote_cmd
        printf -v remote_cmd '%q ' "$@"
        ssh root@$TARGET_HYPERVISOR "pct exec $ctid -- $remote_cmd"
    else
        pct exec "$ctid" -- "$@"
    fi
}

run_pct() {
    if [ -n "$TARGET_HYPERVISOR" ]; then
        ssh root@$TARGET_HYPERVISOR "pct $*"
    else
        pct "$@"
    fi
}

# === LDAP / SSSD Configuration Steps ===

# Curl Pown.sh script to install SSSD and configure LDAP 
run_pct_exec $CONTAINER_ID bash -c "
cd /root && \
curl -O https://raw.githubusercontent.com/anishapant21/pown.sh/main/pown.sh > /dev/null 2>&1 && \
chmod +x pown.sh
"

# Copy .env file to container
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