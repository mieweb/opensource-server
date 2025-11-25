# Build Debian 13 system container
FROM debian:13 AS builder
RUN apt-get update && apt-get install -y \
    curl tar zstd
ARG URL=http://download.proxmox.com/images/system/debian-13-standard_13.1-2_amd64.tar.zst
RUN mkdir /rootfs && curl "$URL" | tar --zstd -x -C /rootfs

FROM scratch
COPY --from=builder /rootfs /

# Install nginx
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

# Install DNSMasq
RUN apt update && apt -y install dnsmasq && systemctl enable dnsmasq
RUN sed -i \
    -e 's/^CONFIG_DIR=\(.*\)$/#CONFIG_DIR=\1/' \
    -e 's/^#IGNORE_RESOLVCONF=\(.*\)$/IGNORE_RESOLVCONF=\1/' \
    /etc/default/dnsmasq

# Install lego
ARG LEGO_VERSION=v4.28.1
RUN curl -fsSL "https://github.com/go-acme/lego/releases/download/${LEGO_VERSION}/lego_${LEGO_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin lego

# Install Prerequisites
RUN apt update && apt -y install git make npm

# Install the software
COPY . /opt/opensource-server
WORKDIR /opt/opensource-server
RUN make install

STOPSIGNAL SIGRTMIN+3
ENTRYPOINT [ "/sbin/init" ]