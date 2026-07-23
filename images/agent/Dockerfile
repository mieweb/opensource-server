# syntax=docker/dockerfile:1
FROM nodejs

# Stage the release APT source so `apt upgrade` pulls future releases of the
# opensource-* packages automatically
COPY images/opensource-server.sources /etc/apt/sources.list.d/opensource-server.sources

# Install the agent package (and its dependencies: nginx with the stream
# module, dnsmasq, ...) built by the builder image.
RUN --mount=from=builder,source=/dist,target=/dist \
    apt-get update && \
    apt-get install -y /dist/opensource-agent_*.deb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Configure DNSMasq to only get its config from our agent
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
