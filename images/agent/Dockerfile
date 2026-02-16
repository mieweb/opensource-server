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

# Install lego for ACME certificate management. We install the build directly from
# the lego GitHub releases since the Debian package is out of date and doesn't
# support Cloudflare DNS validation, which we use.
ARG LEGO_VERSION=v4.28.1
RUN curl -fsSL "https://github.com/go-acme/lego/releases/download/${LEGO_VERSION}/lego_${LEGO_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin lego

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
