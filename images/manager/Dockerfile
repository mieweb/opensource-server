# syntax=docker/dockerfile:1
FROM agent

# Default environment for pull-config. The manager runs the app on localhost
# so it doesn't need an API key. Remote agents must set these explicitly.
ENV SITE_ID=1
ENV MANAGER_URL=http://localhost:3000

# Install Postgres 18 from the PGDG repository and enable remote access only
# for TLS encrypted connections. Debian creates a self-signed cert for this so
# we don't have to make our own.
RUN apt-get update && apt-get -y install postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get -y install postgresql-18 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && echo 'hostssl all all 0.0.0.0/0 scram-sha-256' >>/etc/postgresql/18/main/pg_hba.conf \
    && echo "listen_addresses = '*'" >>/etc/postgresql/18/main/conf.d/opensource-server.conf \
    && mkdir -p /etc/systemd/system/postgresql@.service.d

# Proxmox injects a service which regenerates the snakeoil cert. This systemd
# override prevents a race condition at boot.
COPY images/manager/wait-proxmox-regenerate-snakeoil.conf /etc/systemd/system/postgresql@.service.d/

# First-boot database initialization.
COPY images/manager/container-creator-init.service /etc/systemd/system/container-creator-init.service

# Install the manager and docs packages built by the builder image (the agent
# package is already present from the parent image; apt resolves the
# opensource-server -> opensource-docs dependency), then enable the init
# service.
RUN --mount=from=builder,source=/dist,target=/dist \
    apt-get update && \
    apt-get install -y /dist/opensource-docs_*.deb /dist/opensource-server_*.deb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    systemctl enable container-creator-init.service
