FROM nodejs

# Install all APT packages
RUN apt-get update && \
    apt-get install -y \
        libnginx-mod-stream \
        libnginx-mod-http-modsecurity \
        ssl-cert \
        make \
        dnsmasq \
    && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

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

# Install DNSMasq and configure it to only get it's config from our pull-config
RUN sed -i \
    -e 's/^CONFIG_DIR=\(.*\)$/#CONFIG_DIR=\1/' \
    -e 's/^#IGNORE_RESOLVCONF=\(.*\)$/IGNORE_RESOLVCONF=\1/' \
    /etc/default/dnsmasq

# Install acme.sh for ACME certificate management
RUN curl -fsSL https://get.acme.sh | sh \
    && /root/.acme.sh/acme.sh --upgrade --auto-upgrade

# Install uv for building the docs
ARG UV_VERSION=0.11.6
RUN curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xzf - --strip-components=1 -C /usr/local/bin \
      uv-x86_64-unknown-linux-gnu/uv uv-x86_64-unknown-linux-gnu/uvx

# Install the software. We include the .git directory so that the software can
# update itself without replacing the entire container.
COPY . /opt/opensource-server
RUN cd /opt/opensource-server \
    && make install-pull-config

# Tag the exposed ports for services handled by the container
# NGINX (http, https, quic)
EXPOSE 80
EXPOSE 443
EXPOSE 443/udp
# DNSMASQ
EXPOSE 53
EXPOSE 53/udp
