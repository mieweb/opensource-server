# syntax=docker/dockerfile:1
# This first layer is only to build the root filesystem. We use Proxmox's
# minimal Debian template as it is well maintained and optimized for LXC usage.
FROM debian:13 AS builder
RUN apt-get update && apt-get install -y \
    curl tar zstd
ARG URL=http://download.proxmox.com/images/system/debian-13-standard_13.1-2_amd64.tar.zst
RUN mkdir /rootfs && curl "$URL" | tar --zstd -x -C /rootfs

# Stage 2 of the build uses the root filesystem built in stage 1. The rest of
# the Dockerfile builds from there.
FROM scratch
COPY --from=builder /rootfs /

# Install and setup sssd autoconfiguration
RUN apt-get update && \
    apt-get install -y sssd sudo tmux curl git jq unattended-upgrades && \
    pam-auth-update --enable mkhomedir && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
COPY --chmod=0440 sssd.conf /etc/sssd/sssd.conf
COPY --chmod=0440 ldapusers /etc/sudoers.d/ldapusers

# The following service ensures environment variables set in the OCI metadata
# or container configuration are passed to programs executed by systemd which
# includes user sessions
COPY environment.sh /usr/local/bin/environment.sh
COPY environment.service /etc/systemd/system/environment.service

# Wazuh agent first-boot enrollment service.
# The script checks for WAZUH_MANAGER at runtime; containers without this
# variable skip enrollment silently. The service is enabled unconditionally so
# that it runs automatically when WAZUH_MANAGER is later added via a container
# reconfigure (the sentinel /etc/wazuh-enrolled is only created on success).
COPY wazuh-enroll.sh /usr/local/bin/wazuh-enroll.sh
COPY wazuh-enroll.service /etc/systemd/system/wazuh-enroll.service
RUN chmod +x /usr/local/bin/wazuh-enroll.sh && \
    mkdir -p /etc/systemd/system/multi-user.target.wants && \
    ln -sf /etc/systemd/system/wazuh-enroll.service \
           /etc/systemd/system/multi-user.target.wants/wazuh-enroll.service

# We have to disable systemd-networkd.service and systemd-networkd.socket to
# prevent a race condition preventing DHCP-assigned IP addresses from being used
# when the network is managed via ifupdown2 (which it should be in a Debian LXC)
RUN echo 'disable systemd-networkd.*' >>/etc/systemd/system-preset/99-mieweb-opensource-server.preset

# Configure systemd to run properly in a container. This isn't nessary for LXC
# in Proxmox, but is useful for testing with Docker directly.
STOPSIGNAL SIGRTMIN+3
ENTRYPOINT [ "/sbin/init" ]

# Service metadata, includes port 22/tcp for automatic SSH exposure
EXPOSE 22
