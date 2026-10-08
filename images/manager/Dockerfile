# syntax=docker/dockerfile:1
FROM agent

# Default environment for the site agent. The manager runs the app on
# localhost so it doesn't need an API key. Remote agents must set these
# explicitly. The manager is the default mail host (issue #67): its agent
# reports the `mail` service group and takes the mail-host claim.
ENV SITE_ID=1
ENV MANAGER_URL=http://localhost:3000
ENV AGENT_SERVICES=nginx,dnsmasq,mail

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

# Mail stack (issue #67): Postfix + Dovecot + OpenDKIM, configured entirely by
# the agent once it takes the mail-host claim — preseed "No configuration" and
# keep the units disabled until then. Dovecot/Postfix read accounts live from
# Postgres over the local socket: pg_ident maps their OS users onto the
# read-only mail_* roles created by setup-mail-db-roles.sh (peer auth, no
# passwords). The pg_hba rules must precede the catch-all "local all all peer".
RUN echo 'postfix postfix/main_mailer_type select No configuration' | debconf-set-selections && \
    apt-get update && \
    apt-get -y install postfix postfix-pgsql dovecot-core dovecot-imapd dovecot-lmtpd dovecot-pgsql opendkim && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    systemctl disable postfix dovecot opendkim && \
    sed -i '1i # Mail stack peer-auth maps (opensource-server issue #67)\nlocal all mail_postfix peer map=osmail\nlocal all mail_dovecot peer map=osmail' /etc/postgresql/18/main/pg_hba.conf && \
    { echo 'osmail postfix mail_postfix'; \
      echo 'osmail opensource-mail mail_postfix'; \
      echo 'osmail dovecot mail_dovecot'; } >>/etc/postgresql/18/main/pg_ident.conf

# First-boot database initialization.
COPY images/manager/container-creator-init.service /etc/systemd/system/container-creator-init.service

# Install the manager, docs, and MCP packages built by the builder image (the
# agent package is already present from the parent image; apt resolves the
# opensource-server -> opensource-docs/opensource-mcp dependencies), then
# enable the init service.
RUN --mount=from=builder,source=/dist,target=/dist \
    apt-get update && \
    apt-get install -y /dist/opensource-docs_*.deb /dist/opensource-mcp_*.deb /dist/opensource-server_*.deb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    systemctl enable container-creator-init.service

# Mail ports: SMTP, IMAP(S), submission (STARTTLS + implicit TLS).
EXPOSE 25
EXPOSE 143
EXPOSE 465
EXPOSE 587
EXPOSE 993
