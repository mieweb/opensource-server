---
sidebar_position: 5
---

# Docker Images

OCI container images automatically built and published to GitHub Container Registry (GHCR). Used as base templates for Proxmox containers.

## Available Images

:::note
For custom *application* images (not new base images), see [Building Custom Images](/docs/users/creating-containers/using-environment-variables).
:::

### Debian 13 (`base`)

Debian 13 with systemd (PID 1), SSSD for LDAP authentication, and PAM auto-homedir. Environment variables stored in `/etc/environment`.

**Registry:** `ghcr.io/mieweb/opensource-server/base` · **Source:** [`images/base/`](https://github.com/mieweb/opensource-server/tree/main/images/base)

### NodeJS 24 (`nodejs`)

Extends base with Node.js 24 from NodeSource. Inherits LDAP authentication.

**Registry:** `ghcr.io/mieweb/opensource-server/nodejs` · **Source:** [`images/nodejs/`](https://github.com/mieweb/opensource-server/tree/main/images/nodejs)

### Agent (`agent`)

Extends nodejs with nginx (+ ModSecurity/OWASP CRS), dnsmasq, and [lego](https://github.com/go-acme/lego) for ACME certificate management. Used as the networking layer for each site — handles reverse proxy, DNS, and TLS. See [Deploying Agents](/docs/admins/deploying-agents).

**Registry:** `ghcr.io/mieweb/opensource-server/agent` · **Source:** [`images/agent/`](https://github.com/mieweb/opensource-server/tree/main/images/agent)

### Manager (`manager`)

Extends agent with PostgreSQL 18. Runs the full management application. See [Installation Guide](/docs/admins/installation).

**Registry:** `ghcr.io/mieweb/opensource-server/manager` · **Source:** [`images/manager/`](https://github.com/mieweb/opensource-server/tree/main/images/manager)

## Build System

Images use **Docker Bake** (`docker buildx bake`) with [`images/docker-bake.hcl`](https://github.com/mieweb/opensource-server/blob/main/images/docker-bake.hcl) defining build order and dependencies. The `contexts` attribute ensures proper ordering (e.g., nodejs depends on base).

```
images/
├── docker-bake.hcl          # Build config with dependency ordering
├── base/
│   ├── Dockerfile
│   ├── sssd.conf
│   └── ldapusers
├── nodejs/
│   └── Dockerfile           # Extends base image
├── agent/
│   └── Dockerfile           # Extends nodejs (nginx, dnsmasq, lego)
└── manager/
    └── Dockerfile           # Extends agent (PostgreSQL, full app)
```

## CI Workflow

[`build-images.yml`](https://github.com/mieweb/opensource-server/blob/main/.github/workflows/build-images.yml) builds and pushes all images via Docker Bake.

### Triggers

| Trigger | Condition |
|---------|-----------|
| Push | Any branch, when files in `images/` change |
| Tag | Any tag push |
| Schedule | Weekly — Sunday 11PM UTC |
| Manual | `workflow_dispatch` from Actions tab |

### How it works

1. Checks out the repo and sets up Docker Buildx
2. Logs into GHCR using `GITHUB_TOKEN`
3. Runs a **Docker Meta** step per image to generate tags
4. Runs `docker buildx bake` with the HCL file + all meta bake files, pushing in dependency order
5. Uses per-image GitHub Actions cache (`scope=<image>-<branch>`)

### Tags

Each Docker Meta step produces these tags:

| `type=` | Result | When |
|---------|--------|------|
| `sha` | `base:sha-d00911c` | Always |
| `ref,event=branch` | `base:main` | Branch pushes |
| `ref,event=tag` | `base:v1.0.0` | Tag pushes |
| `raw,value=latest,enable=...` | `base:latest` | Main branch only |

### Adding your image to the workflow

Add a new **Docker Meta** step and wire it into the **Build and push** step:

```yaml
      # 1. Add a metadata step (copy an existing one, change image name and bake-target)
      - name: Docker Meta (Your Image)
        id: meta-your-image
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ github.repository }}/your-image
          bake-target: your-image
          tags: |
            type=sha
            type=ref,event=branch
            type=ref,event=tag
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      # 2. In the "Build and push" step, append to `files:` and `set:`
      - name: Build and push
        uses: docker/bake-action@v5
        with:
          workdir: ./images
          push: true
          files: |
            ./docker-bake.hcl
            ${{ steps.meta-base.outputs.bake-file }}
            ${{ steps.meta-nodejs.outputs.bake-file }}
            ${{ steps.meta-your-image.outputs.bake-file }}    # add this
          set: |
            # ... existing cache lines ...
            your-image.cache-from=type=gha,scope=your-image-${{ github.ref_name }}
            your-image.cache-to=type=gha,mode=max,scope=your-image-${{ github.ref_name }}
```

The `bake-target` must match the target name in `docker-bake.hcl`. The metadata action generates a bake file that overrides that target's `tags` array.

## Adding a New Base Image

Add a base image when a runtime is commonly needed by multiple users and requires system-level configuration. Don't add images for single-use or org-specific software.

### 1. Create the Dockerfile

Create a new directory under `images/` with a Dockerfile:

```dockerfile
# syntax=docker/dockerfile:1
FROM base

# Install your runtime
RUN apt-get update && \
    apt-get install -y your-packages && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
```

**Rules:**
- `FROM base` — Docker Bake resolves this to the freshly built base image via `contexts`
- Use `EXPOSE` to declare ports that should become container Services automatically
- Use `LABEL org.mieweb.opensource-server.services.http.default-port=<port>` to set a default HTTP port (associated with `<hostname>.<externalDomainName>`)
- **Never** set `CMD`, `ENTRYPOINT`, `WORKDIR`, or `USER` — base images run systemd as PID 1

### 2. Update docker-bake.hcl

Add a target and include it in the default group:

```hcl
group "default" {
    targets = ["base", "nodejs", "your-image"]
}

target "your-image" {
    context = "./your-image"
    contexts = {
        base = "target:base"
    }
}
```

### 3. Update the CI workflow

Add a Docker Meta step and wire it into the build step as described in [Adding your image to the workflow](#adding-your-image-to-the-workflow) above.

### 4. Test locally

```bash
cd images && docker buildx bake your-image
```

Verify: runtime installed, systemd running, `/etc/environment` exists.

### 5. Update docs and frontend

- Add the image to the [Available Images](#available-images) section above
- Update `docs/users/creating-containers/web-gui.mdx` template list
- Update `create-a-container/views/containers/form.ejs` dropdown

### 6. Submit PR

```bash
git add images/your-image/ images/docker-bake.hcl .github/workflows/build-images.yml
git commit -m "Add your-image base image"
```
