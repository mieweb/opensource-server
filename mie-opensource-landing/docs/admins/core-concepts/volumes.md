
# Volumes

Volumes are persistent bind-mount directories attached to containers. Unlike a
container's root filesystem, volume data **survives delete + recreate** on the
same hostname — the host directory is retained when the container is removed and
reattached when a container of the same hostname is created again.

Volumes replace the earlier hardcoded shared `quick_and_dirty` read-only mount.
That stopgap is fully removed: no volume is attached to a container unless its
creator explicitly adds one. (Containers that existed before this change keep
their original `quick_and_dirty` mount, recorded in the database for reference;
it is not re-applied and new containers never receive it.)

## How volumes work

1. A volume is defined per container with a **name**, a guest **mount path**
   (e.g. `/mnt/data`), and a **mode** (`ro` read-only or `rw` read-write).
2. The host directory lives under `<volumesRoot>/<hostname>/<name>`, where
   `<volumesRoot>` is derived from the node's **volume storage** actual
   configured path (not assumed) plus `/volumes`.
3. When a container is created (or reconfigured), the site's **agent** creates
   the host directory. The agent is a single per-site container with the shared
   volumes root bind-mounted in; because it runs with the same unprivileged
   id-mapping as the consuming containers (host UID/GID `100000` = guest root),
   the directory it creates is writable from inside a read-write container
   without any `chown`. See [Deploying Agents → Volume storage](../deploying-agents.md#volume-storage-for-persistent-volumes)
   for the one-time bind-mount + pre-create setup.
4. The create job **waits** until the directory is ready (the agent reports it
   at check-in) before attaching the bind mount — Proxmox rejects a mount whose
   host directory does not yet exist. The wait happens **before** the container
   is provisioned, so a provisioning failure never leaves a half-created
   container behind.

## Shared storage is required

!!! warning "Place the volumes root on shared storage"
    A single per-site agent creates volume directories on the shared volumes
    root that is bind-mounted into it. For a directory to exist wherever a
    container is placed or migrated, the **volume storage must be a path-backed
    shared filesystem** — CephFS or NFS (`shared=1`) — that every node mounts.
    Block storages (Ceph RBD, LVM, ZFS) expose no host directory path and
    therefore cannot host volumes.

    On node-local storage (`dir`/`lvm`/`zfspool` with `shared=0`), the directory
    will not exist where a container on another node lands and the data will not
    follow it. Single-node sites are unaffected.

    When you save a node's configuration, the manager checks the chosen volume
    storage against the cluster topology and **warns** (it does not block) if the
    storage is not shared or is not active on every node. Move the volumes root
    to shared storage to clear the warning.

## Backup

!!! danger "Volume data is not backed up by the platform"
    Bind-mount contents are **not** included in Proxmox `vzdump`, so container
    backups do **not** cover volume data. The platform prescribes no backup
    mechanism for volumes. **Operators are responsible for backing up the
    underlying shared storage** that hosts the volumes root.

## Deletion and reclamation

Deleting a container **retains** its volume directories on the node so a later
container with the same hostname reattaches the existing data. The platform does
**not** garbage-collect retained/orphaned directories; reclaiming them is a
manual/ops task.

## Docker nodes

On Docker nodes, volumes map to Docker bind mounts (`<hostPath>:<mountPath>[:ro]`).
Docker auto-creates the host bind-source directory at container start, so there
is no separate agent step and no shared-storage precondition on a single Docker
host.
