# Debian OCI image template using Proxmox minimal LXC rootfs
#
# This multi-stage Dockerfile downloads Proxmox's minimal Debian LXC template
# (tar.zst) and unpacks it into the final image rootfs. This produces a
# filesystem layout suitable for OCI/LXC usage and avoids depending on a Debian
# base image that may differ from Proxmox's optimized template.

FROM debian:13 AS builder
ARG URL="http://download.proxmox.com/images/system/debian-13-standard_13.1-2_amd64.tar.zst"
ARG DOMAIN
RUN apt-get update && apt-get install -y --no-install-recommends \
	curl \
	tar \
	zstd \
	ca-certificates && \
	rm -rf /var/lib/apt/lists/* && \
	mkdir -p /rootfs/usr/local/bin && \
	curl -fsSL "$URL" | tar --zstd -x -C /rootfs && \
	curl -fsSL https://pown.sh/ -o /tmp/pown.sh && \
	chmod +x /tmp/pown.sh && \
	cp /tmp/pown.sh /rootfs/usr/local/bin/pown.sh && \
	chmod +x /rootfs/usr/local/bin/pown.sh && \
	chroot /rootfs /usr/local/bin/pown.sh "$DOMAIN"

# Final image uses the unpacked rootfs
FROM scratch
COPY --from=builder /rootfs /

# Optional: allow customizations at build-time (example: run site installer)
ARG DOMAIN
RUN true
