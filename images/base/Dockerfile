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

# Install and setup sssd autoconfiguration
RUN apt-get update && \
    apt-get install -y sssd && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
COPY sssd-autoconfigure.sh /usr/local/bin/sssd-autoconfigure
COPY sssd-autoconfigure.service /etc/systemd/system/
RUN chmod +x /usr/local/bin/sssd-autoconfigure && \
    systemctl enable sssd-autoconfigure.service

# Configure systemd to run properly in a container. This isn't nessary for LXC
# in Proxmox, but is useful for testing with Docker directly.
STOPSIGNAL SIGRTMIN+3
ENTRYPOINT [ "/sbin/init" ]
