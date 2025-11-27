# This first layer is only to build the root filesystem. We use Proxmox's
# minimal Debian template as it is well maintained and optimized for LXC usage.
FROM debian:13 AS builder
RUN apt-get update && apt-get install -y \
    curl tar zstd
ARG URL=http://download.proxmox.com/images/system/debian-13-standard_13.1-2_amd64.tar.zst
RUN mkdir /rootfs && curl "$URL" | tar --zstd -x -C /rootfs

# Stage 2 of the build uses the root filesystem built in stage 1. The rest of
# the Dockerfile builds from there.
FROM scratch
COPY --from=builder /rootfs /

# Install nginx mainline for the most up-to-date features
RUN apt update && apt -y install curl gnupg2 ca-certificates lsb-release debian-archive-keyring \
    && curl https://nginx.org/keys/nginx_signing.key | gpg --dearmor \
        | tee /usr/share/keyrings/nginx-archive-keyring.gpg >/dev/null \
    && echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] \
        http://nginx.org/packages/mainline/debian `lsb_release -cs` nginx" \
        | tee /etc/apt/sources.list.d/nginx.list \
    && echo "Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n" \
        | tee /etc/apt/preferences.d/99nginx \
    && cat /etc/apt/preferences.d/99nginx \
    && apt update \
    && apt install -y nginx ssl-cert \
    && systemctl enable nginx

# Install DNSMasq and configure it to only get it's config from our pull-config
RUN apt update && apt -y install dnsmasq && systemctl enable dnsmasq
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

# Install requisites: git for updating the software, make and npm for installing
# and management.
RUN apt update && apt -y install git make npm

# Install the software. We include the .git directory so that the software can
# update itself without replacing the entire container.
COPY . /opt/opensource-server
WORKDIR /opt/opensource-server
RUN make install

# Configure systemd to run properly in a container. This isn't nessary for LXC
# in Proxmox, but is useful for testing with Docker directly.
STOPSIGNAL SIGRTMIN+3
ENTRYPOINT [ "/sbin/init" ]