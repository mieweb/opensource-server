
# Volumes

Volumes are persistent bind-mount directories attached to containers. Unlike a
container's root filesystem, volume data **survives delete + recreate** on the
same hostname — the host directory is retained when the container is removed and
reattached when a container of the same hostname is created again.

Volumes replace the earlier hardcoded shared `quick_and_dirty` read-only mount,
which is now modeled as a built-in read-only volume.

## How volumes work

1. A volume is defined per container with a **name**, a guest **mount path**
   (e.g. `/mnt/data`), and a **mode** (`ro` read-only or `rw` read-write).
2. The host directory lives under `<volumesRoot>/<hostname>/<name>`, where
   `<volumesRoot>` is derived from the node's **volume storage** actual
   configured path (not assumed) plus `/volumes`.
3. When a container is created (or reconfigured), the **site agent** creates the
   host directory on the node with the correct ownership for the unprivileged
   container's id-mapped root, so read-write volumes are writable from inside
   the container.
4. The create job **waits** until the directory is ready before attaching the
   bind mount — Proxmox rejects a mount whose host directory does not yet exist.

## Shared storage is required

!!! warning "Place the volumes root on shared storage"
    The site agent creates a volume's directory on **its own node**. If a
    container is placed or migrated to another node, the directory only exists
    there when the **volume storage is shared across every node** (CephFS/RBD,
    NFS, or equivalent, with `shared=1`).

    On node-local storage (`dir`/`lvm`/`zfspool` with `shared=0`), the directory
    will not exist where a migrated container lands and the data will not follow
    it. Single-node sites are unaffected.

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
