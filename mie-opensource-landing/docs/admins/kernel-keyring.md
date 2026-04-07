---
sidebar_position: 8
---

# Kernel Keyring Configuration

Configure kernel keyring quotas on Proxmox hosts so the unprivileged UID mapped to `root` inside containers has the same key limits as the real host root, preventing quota exhaustion under nested Docker/LXC virtualization.

## Apply the Settings

Run the following on every Proxmox host node:

```bash
# Increase max number of keys allowed per UID
sysctl -w kernel.keys.maxkeys=200000

# Increase max bytes of kernel memory for keys per UID
sysctl -w kernel.keys.maxbytes=2000000
```

To persist across reboots, add the values to `/etc/sysctl.d/99-kernel-keys.conf`:

```bash
cat >> /etc/sysctl.d/99-kernel-keys.conf << 'EOF'
# Allow unprivileged container root the same keyring limits as host root.
# Prevents "unable to create session key: disk quota exceeded" under nested
# virtualization (e.g. Docker inside LXC).
kernel.keys.maxkeys=200000
kernel.keys.maxbytes=2000000
EOF

sysctl --system
```

:::important
These settings must be applied on every Proxmox node where nested Docker builds or Docker-in-LXC workloads run.
:::
