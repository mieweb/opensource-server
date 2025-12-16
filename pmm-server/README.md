# Running in an unprivileged LXC

`docker compose up -d` doesn't work in unprivileged LXCs due to sysctl restrictions. To work around this, we use the standalone `docker-compose` CLI with `podman-docker` and FUSE filesystems.

1. Enable `fuse=1` in the LXC features
2. Install `podman-docker` and `fuse-overlayfs` in Debian
3. Configure Podman to use FUSE overlay

```
# /etc/containers/storage.conf
[storage]
driver = "overlay"
runroot = "/run/containers/storage"
graphroot = "/var/lib/containers/storage"

[storage.options]
mount_program = "/usr/bin/fuse-overlayfs"
```

```
# /etc/containers/containers.conf
[containers]
default_ulimits = []
```

4. Install the standalone `docker-compose` binary from GitHub Releases

```
curl -fsSL https://github.com/docker/compose/releases/download/latest/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

5. Run `docker-compose up -d`