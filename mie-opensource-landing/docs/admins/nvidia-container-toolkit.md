---
sidebar_position: 7
---

# NVIDIA Container Toolkit

Configure Proxmox VE nodes to pass NVIDIA GPUs through to LXC containers.

## 1. Install the NVIDIA Driver

Install from Debian's official repositories. On Proxmox VE (Debian-based), `non-free-firmware` must be enabled.

```bash
# Ensure non-free sources are available
apt update
apt install -y nvidia-driver
```

If the packaged version is too old for your GPU, install from Debian backports:

```bash
apt install -y -t bookworm-backports nvidia-driver
```

Reboot after installation and verify with `nvidia-smi`.

## 2. Install the NVIDIA Container Toolkit

Follow the official NVIDIA installation guide for your distribution:

👉 [NVIDIA Container Toolkit — Install Guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)

The short version for Debian/Ubuntu:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

apt update
apt install -y nvidia-container-toolkit
```

## 3. Create the Hookscript Symlink

The application passes GPU access to containers via an LXC hookscript. Proxmox stores snippets in `/var/lib/vz/snippets/`, but the hook file is installed to `/usr/share/lxc/hooks/nvidia` by the `lxc-common` package (installed automatically as a dependency). Create a symlink so Proxmox can find it:

```bash
mkdir -p /var/lib/vz/snippets
ln -sf /usr/share/lxc/hooks/nvidia /var/lib/vz/snippets/nvidia
```

Verify the symlink:

```bash
ls -la /var/lib/vz/snippets/nvidia
# Should show: /var/lib/vz/snippets/nvidia -> /usr/share/lxc/hooks/nvidia
```

:::important
This symlink must exist on every Proxmox node where NVIDIA containers will be created. Without it, containers will be created but GPU passthrough will not function. The application logs a warning during container creation if the hookscript is missing.
:::

## 4. Mark the Node as NVIDIA-Capable

After completing the host-level setup, mark the node as NVIDIA-capable in the application:

1. Navigate to **Nodes** → select the node
2. Enable the **NVIDIA Available** flag
3. Save

Users will then be able to request NVIDIA GPU access when creating containers on this site.
