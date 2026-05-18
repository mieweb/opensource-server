# syntax=docker/dockerfile:1
# We intentionally revert to the Docker-provided Debian 13 for this image rather
# than our "base" image since the Proxmox is expected to be administrator-
# managed in a production environment. Thus the only changes we make are to
# convert it from Debian to Proxmox, a few modifications so it'll run in Docker,
# and then the bootstrap service that would normally require the admin to run.
FROM debian:13

# Add the Proxmox repo key
ADD --chmod=0644 \
    https://enterprise.proxmox.com/debian/proxmox-archive-keyring-trixie.gpg \
    /usr/share/keyrings/proxmox-archive-keyring.gpg

# Add the PVE repo
COPY pve-install-repo.sources /etc/apt/sources.list.d/

# Install the Proxmox packages
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        openssh-server \
        openssh-client \
        proxmox-archive-keyring \
        pve-manager \
        systemd-sysv \
        e2fsprogs \
        skopeo \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm /etc/apt/sources.list.d/pve-enterprise.sources /etc/network/interfaces.new

# Add the init service
COPY create-manager.service /etc/systemd/system/create-manager.service
RUN systemctl enable create-manager.service

# Override standard settings that fail under Docker containerization
COPY enable-lxcfs.conf /etc/systemd/system/lxcfs.service.d/enable-lxcfs.conf

# Set default password
RUN echo 'root' | passwd --stdin

# Configure network interfaces
COPY interfaces /etc/network/interfaces

# Set the entrypoint so all the Proxmox services will run
ENTRYPOINT ["/sbin/init"]

# The healthcheck checks for the Manager container to be up and running not just
# the Proxmox. This is used to delay running the bootstrap script in the compose
# file until the manager is ready for API calls.
HEALTHCHECK \
    --interval=30s \
    --timeout=30s \
    --start-period=60s \
    --start-interval=5s \
    --retries=5 \
    CMD curl -Ik https://10.254.0.2
