FROM debian:13

# Add the Proxmox repo key
ADD --chmod=0644 https://enterprise.proxmox.com/debian/proxmox-archive-keyring-trixie.gpg /usr/share/keyrings/proxmox-archive-keyring.gpg

# Add the PVE repo
COPY pve-install-repo.sources /etc/apt/sources.list.d/

# Install the Proxmox packages
RUN apt-get update \
    && apt-get install -y proxmox-ve postfix open-iscsi chrony e2fsprogs \
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
HEALTHCHECK --interval=30s --timeout=30s --start-period=60s --start-interval=5s --retries=5 CMD curl -Ik https://10.254.0.2
