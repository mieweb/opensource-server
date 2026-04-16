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

# Install and setup sssd autoconfiguration.
# ldap-utils provides ldapsearch, used by the git-identity profile script to
# fetch a user's email from the internal LDAP server on first interactive login.
RUN apt-get update && \
    apt-get install -y sssd sudo tmux curl gnupg git jq ldap-utils unattended-upgrades locales && \
    echo 'en_US.UTF-8 UTF-8' >> /etc/locale.gen && \
    locale-gen && \
    update-locale LANG=en_US.UTF-8 && \
    pam-auth-update --enable mkhomedir && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
COPY --chmod=0440 sssd.conf /etc/sssd/sssd.conf
COPY --chmod=0440 ldapusers /etc/sudoers.d/ldapusers
COPY --chmod=0644 ldap.conf /etc/ldap/ldap.conf
COPY --chmod=0755 git-identity.sh /etc/profile.d/git-identity.sh

# The following service ensures environment variables set in the OCI metadata
# or container configuration are passed to programs executed by systemd which
# includes user sessions
COPY environment.sh /usr/local/bin/environment.sh
COPY environment.service /etc/systemd/system/environment.service

# Wazuh agent — pre-installed at build time so containers don't need internet
# access at first boot to install it. The enrollment service only runs the
# lightweight config + enrollment step at runtime.
RUN curl -fsSL https://packages.wazuh.com/key/GPG-KEY-WAZUH \
      | gpg --dearmor -o /usr/share/keyrings/wazuh.gpg && \
    printf 'Types: deb\nURIs: https://packages.wazuh.com/4.x/apt/\nSuites: stable\nComponents: main\nSigned-By: /usr/share/keyrings/wazuh.gpg\n' \
      > /etc/apt/sources.list.d/wazuh.sources && \
    apt-get update && \
    apt-get install -y --no-install-recommends wazuh-agent && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Wazuh agent first-boot enrollment service.
# The script checks for WAZUH_MANAGER at runtime; containers without this
# variable skip enrollment silently. ConditionFileNotEmpty ensures the service
# only runs when the agent has never successfully enrolled (client.keys is empty).
COPY --chmod=0755 wazuh-enroll.sh /usr/local/bin/wazuh-enroll.sh
COPY wazuh-enroll.service /etc/systemd/system/wazuh-enroll.service

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
