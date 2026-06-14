# syntax=docker/dockerfile:1
FROM nodejs

# Stage the release APT source so `apt upgrade` pulls future releases of the
# opensource-* packages automatically. A missing release (e.g. during image
# builds) is a non-fatal `apt update` warning, so the source can live here for
# the whole build.
COPY images/opensource-server.sources /etc/apt/sources.list.d/opensource-server.sources

# Install the agent package (and its dependencies: nginx with stream +
# ModSecurity modules, dnsmasq, cron, ...) built by the builder image. The
# package is bind-mounted from the builder stage rather than copied so it does
# not add an image layer. `apt-get update` is allowed to fail because the
# release APT source may 404 during a build (the release being built may not
# exist yet); the install uses cached indices.
RUN --mount=from=builder,source=/dist,target=/dist \
    { apt-get update || true; } && \
    apt-get install -y /dist/opensource-agent_*.deb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Everything below is image-level environment configuration that the package
# does not own because it edits conffiles belonging to other packages
# (nginx, modsecurity-crs, dnsmasq).

# configure nginx ModSecurity defaults
RUN sed -i \
        -e 's!^#\(include /usr/share/modsecurity-crs/owasp-crs.load\)$!\1!' \
        /etc/nginx/modsecurity_includes.conf \
    && sed -i -e 's/IncludeOptional/Include/' /usr/share/modsecurity-crs/owasp-crs.load \
    && sed -i -e 's/^SecRuleEngine .*$/SecRuleEngine DetectionOnly/' /etc/nginx/modsecurity.conf

# Logrotate overrides for NGINX and ModSecurity to work around a logrotate
# repoen bug at https://github.com/owasp-modsecurity/ModSecurity-nginx/issues/351
COPY ./images/agent/nginx.logrotate /etc/logrotate.d/nginx

# Apply custom ModSecurity configurations. See the blame on that file for
# details on what's been changed from stock.
COPY ./images/agent/crs-setup.conf /etc/modsecurity/crs/crs-setup.conf
COPY ./images/agent/RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf /etc/modsecurity/crs/RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf

# Configure DNSMasq to only get its config from our pull-config
RUN sed -i \
    -e 's/^CONFIG_DIR=\(.*\)$/#CONFIG_DIR=\1/' \
    -e 's/^#IGNORE_RESOLVCONF=\(.*\)$/IGNORE_RESOLVCONF=\1/' \
    /etc/default/dnsmasq

# Install acme.sh for ACME certificate management
RUN curl -fsSL https://get.acme.sh | sh \
    && /root/.acme.sh/acme.sh --upgrade --auto-upgrade

# Tag the exposed ports for services handled by the container
# NGINX (http, https, quic)
EXPOSE 80
EXPOSE 443
EXPOSE 443/udp
# DNSMASQ
EXPOSE 53
EXPOSE 53/udp
