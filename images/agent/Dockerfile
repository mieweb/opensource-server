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
    && sed -i -e 's/^SecRuleEngine .*$/SecRuleEngine On/' /etc/nginx/modsecurity.conf

# Install DNSMasq and configure it to only get it's config from our pull-config
RUN sed -i \
    -e 's/^CONFIG_DIR=\(.*\)$/#CONFIG_DIR=\1/' \
    -e 's/^#IGNORE_RESOLVCONF=\(.*\)$/IGNORE_RESOLVCONF=\1/' \
    /etc/default/dnsmasq

# Install acme.sh for ACME certificate management
RUN curl -fsSL https://get.acme.sh | sh \
    && /root/.acme.sh/acme.sh --upgrade --auto-upgrade

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
