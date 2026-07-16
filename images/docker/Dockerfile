# syntax=docker/dockerfile:1
# Docker Engine (Community Edition) image.
#
# The `base` build context is a NAMED context supplied by docker-bake.hcl, so
# this one Dockerfile produces two images:
#   * target "docker"        - base = target:base   (Debian 13 + Docker)
#   * target "docker-nodejs" - base = target:nodejs (NodeJS 24 + Docker)
FROM base

# Docker Engine (latest stable) from Docker's official APT repository.
ARG DEBIAN_SUITE=trixie
RUN curl -fsSL https://download.docker.com/linux/debian/gpg \
      | gpg --dearmor -o /usr/share/keyrings/docker.gpg && \
    printf 'Types: deb\nURIs: https://download.docker.com/linux/debian\nSuites: %s\nComponents: stable\nSigned-By: /usr/share/keyrings/docker.gpg\n' "$DEBIAN_SUITE" \
      > /etc/apt/sources.list.d/docker.sources && \
    apt-get update && \
    apt-get install -y \
      docker-ce \
      docker-ce-cli \
      containerd.io \
      docker-buildx-plugin \
      docker-compose-plugin && \
    systemctl enable docker.service docker.socket && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Give every LDAP user access to the Docker socket by making membership of
# the LDAP `ldapusers` group imply membership of the local `docker` group.
#
# LDAP users cannot be listed in the local docker group (their memberships
# come from LDAP via SSSD), so pam_group grants the docker group to their
# sessions at login instead. The group.conf rule matches by NAME on both
# sides - `%ldapusers` is resolved through NSS/SSSD exactly like the
# `%ldapusers` sudoers rule in the base image - so no GID is hardcoded and
# the stock docker.socket unit and docker group are left untouched. There is
# also no boot-time ordering concern: resolution happens at login, when SSSD
# is necessarily up (otherwise the LDAP user could not log in at all).
#
# pam_group is enabled via pam-auth-update (the same mechanism the base image
# uses for mkhomedir) and acts during pam_setcred, which sshd applies to both
# password and public-key logins.
#
# NOTE: access to the Docker socket is root-equivalent inside the container;
# ldapusers already hold sudo here (see /etc/sudoers.d/ldapusers in the base
# image), so this grants no privilege they don't already have.
COPY --chmod=0644 pam-group /usr/share/pam-configs/pam-group
RUN printf '\n# Members of the LDAP ldapusers group get the local docker group at login.\n*;*;%%ldapusers;Al0000-2400;docker\n' \
      >> /etc/security/group.conf && \
    pam-auth-update --enable pam-group
