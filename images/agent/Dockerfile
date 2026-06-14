FROM nodejs

# Install the agent package (and its dependencies: nginx with stream +
# ModSecurity modules, dnsmasq, cron, ...) built by the builder image.
COPY --from=builder /dist/opensource-agent_*.deb /tmp/debs/
RUN apt-get update && \
    apt-get install -y /tmp/debs/*.deb && \
    rm -rf /tmp/debs && \
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

# Stage the release APT source so `apt upgrade` pulls future releases of the
# opensource-* packages automatically. Added last so it is never consulted by
# an `apt update` during this build (the release may not exist yet).
COPY images/opensource-server.sources /etc/apt/sources.list.d/opensource-server.sources

# Tag the exposed ports for services handled by the container
# NGINX (http, https, quic)
EXPOSE 80
EXPOSE 443
EXPOSE 443/udp
# DNSMASQ
EXPOSE 53
EXPOSE 53/udp
