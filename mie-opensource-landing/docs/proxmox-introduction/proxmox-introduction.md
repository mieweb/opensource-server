---
sidebar_position: 1
---


# Proxmox Introduction

:::note Note
This section provides a high-level overview of how Proxmox works. The next section, **[How MIE's Proxmox Cluster Works](/docs/proxmox-introduction/how-our-cluster-works.md)**, explains how we set up our Proxmox cluster specifically.
:::

Proxmox Virtual Environment (Proxmox VE) is an open-source platform for managing virtual machines (VMs) and containers. It is widely used for building scalable, secure, and flexible infrastructure in both enterprise and research environments.

## What is Proxmox?
Proxmox VE is a **Type 1 hypervisor**, meaning it runs directly on the hardware (bare metal) and manages virtualized resources without needing a host operating system. This provides high performance, security, and resource isolation.

## Containers vs. Virtual Machines
- **Virtual Machines (VMs):** Full virtualization, each VM runs its own operating system and kernel. Suitable for running different OS types or legacy applications.
- **Containers (LXC):** Lightweight virtualization, containers share the host kernel but are isolated from each other. Ideal for running multiple Linux environments efficiently.

:::note Note
In our cluster, we focus on creating and managing **containers** for resource efficiency and simplicity.
:::

## Filesystem & Volumes
- **Filesystem:** Each container is provisioned with its own root filesystem (rootfs), isolated from other containers. In our setup, the rootfs for each container is stored as a dedicated ZFS volume (dataset). ZFS is a robust, modern filesystem and volume manager that provides features like snapshots, compression, and data integrity checks. Using ZFS allows you to easily manage, backup, and migrate containers individually. Snapshots can be taken for quick backups or rollbacks, and ZFS handles storage efficiently.
- **Volumes:** Storage volumes are allocated to containers for persistent data. You can attach, detach, and resize volumes as needed.

## Container Templating

Container templates in Proxmox serve as reusable blueprints for creating new containers quickly and consistently. Templates can include pre-installed packages, network configurations, and services, allowing you to standardize environments across your cluster.

- **Cloning:** New containers are cloned from templates, inheriting all configurations and installed software.
- **Customization:** Different templates can be tailored for specific use cases, such as web servers, development environments, or database nodes.
- **Efficiency:** Using templates streamlines deployment, reduces setup time, and ensures consistency.

Templates are managed through the Proxmox web interface, where you can create, update, and deploy containers based on your preferred configurations.

## User Accounts & Permissions
- **User Accounts:** Each user has a unique account for accessing the Proxmox web interface and managing resources.
- **Permissions:** Role-based access control (RBAC) lets administrators assign permissions to users and groups, controlling who can create, modify, or delete containers and volumes.
- **Authentication:** Supports local users, LDAP, and other authentication backends for secure access.

## Monitoring Container Metrics
Proxmox provides real-time monitoring and historical metrics for each container:
- **CPU (Cores):** Track usage and allocation per container
- **RAM:** Monitor memory consumption and limits
- **Swap:** View swap usage for containers under heavy load
- **SSD:** Check disk I/O, storage usage, and performance

The Proxmox dashboard offers graphs and statistics for each metric, helping you optimize resource usage and troubleshoot performance issues.

---

Want to see how our Proxmox Cluster works specifically? Head to the next section!

