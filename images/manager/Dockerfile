FROM agent

# Default environment for pull-config. The manager runs the app on localhost
# so it doesn't need an API key. Remote agents must set these explicitly.
ENV SITE_ID=1
ENV MANAGER_URL=http://localhost:3000

# The release APT source is inherited from the agent image. Remove it for the
# duration of this build so `apt update` (PGDG, package installs) is never
# blocked by the release not existing yet; it is re-added at the end.
RUN rm -f /etc/apt/sources.list.d/opensource-server.sources

# Install Postgres 18 from the PGDG repository and enable remote access only
# for TLS encrypted connections. Debian creates a self-signed cert for this so
# we don't have to make our own. The opensource-server package only suggests
# postgresql (a remote database is equally valid); this image opts into a
# local one.
RUN apt update && apt -y install postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt -y install postgresql-18 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && echo 'hostssl all all 0.0.0.0/0 scram-sha-256' >>/etc/postgresql/18/main/pg_hba.conf \
    && echo "listen_addresses = '*'" >>/etc/postgresql/18/main/conf.d/opensource-server.conf \
    && mkdir -p /etc/systemd/system/postgresql@.service.d

# Proxmox injects a service which regenerates the snakeoil cert. This systemd
# override prevents a race condition at boot. It is environment-specific, so
# it lives in the image rather than the package.
COPY images/manager/wait-proxmox-regenerate-snakeoil.conf /etc/systemd/system/postgresql@.service.d/

# Install the manager and docs packages built by the builder image. The agent
# package is already present from the parent image; apt resolves the
# opensource-server -> opensource-docs dependency. The package postinstall
# enables the manager systemd units, and systemd LogDirectory creates
# /var/log/opensource-server on demand.
COPY --from=builder /dist/opensource-docs_*.deb /dist/opensource-server_*.deb /tmp/debs/
RUN apt-get update && \
    apt-get install -y /tmp/debs/*.deb && \
    rm -rf /tmp/debs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Re-add the release APT source (removed at the top) so `apt upgrade` pulls
# future releases of the opensource-* packages automatically.
COPY images/opensource-server.sources /etc/apt/sources.list.d/opensource-server.sources
