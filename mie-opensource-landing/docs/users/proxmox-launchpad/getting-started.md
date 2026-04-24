
# Getting Started

Set up the Launchpad GitHub Action to automatically deploy Docker/OCI images as containers on MIE's Proxmox cluster.

## Prerequisites

- A Docker/OCI image published to a container registry (GHCR, Docker Hub, etc.)
- An API key for the create-a-container server (request one from your site admin)

## Repository Secrets

Add these secrets in your repository's **Settings > Secrets and variables > Actions**:

| Secret | Description |
|--------|-------------|
| `LAUNCHPAD_API_KEY` | API key for the create-a-container server |
| `LAUNCHPAD_API_URL` | Base URL of the create-a-container server |

## Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api_key` | Yes | — | Bearer token for authenticating with the create-a-container API |
| `api_url` | Yes | — | Base URL of the create-a-container server |
| `template_name` | No | — | Docker/OCI image reference to deploy (e.g., `ghcr.io/org/app:tag`). Omit to delete the container. |
| `container_env_vars` | No | — | Environment variables to set inside the container (JSON string, e.g., `'{"NODE_ENV": "production"}'`) |
| `services` | No | — | Services configuration (JSON array) |
| `site_id` | No | `1` | Site ID for the container management system |

## Supported Workflow Events

| Event | Action |
|-------|--------|
| `push` | Creates or locates the container for the branch |
| `create` | Creates a container for the new branch |
| `pull_request` (opened/synchronize/reopened) | Creates or locates the container for the PR head branch |
| `pull_request` (closed) | Deletes the container |
| `delete` | Deletes the container for the deleted branch |

## Basic Usage

```yaml
- uses: mieweb/launchpad@main
  with:
    api_key: ${{ secrets.LAUNCHPAD_API_KEY }}
    api_url: ${{ secrets.LAUNCHPAD_API_URL }}
    template_name: ghcr.io/your-org/your-app:latest
```

## PR Preview Environments

Deploy preview containers on pull requests and clean them up automatically when the PR closes. This is the most common pattern:

```yaml
name: PR Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  deploy-preview:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: mieweb/launchpad@main
        with:
          api_key: ${{ secrets.LAUNCHPAD_API_KEY }}
          api_url: ${{ secrets.LAUNCHPAD_API_URL }}
          template_name: ghcr.io/your-org/your-app:pr-${{ github.event.pull_request.number }}

  cleanup-preview:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: mieweb/launchpad@main
        with:
          api_key: ${{ secrets.LAUNCHPAD_API_KEY }}
          api_url: ${{ secrets.LAUNCHPAD_API_URL }}
```

When `template_name` is omitted (as in `cleanup-preview`), the action removes the container associated with the current branch or PR.

## Complete Example: Build + Deploy

This example builds a Docker image, pushes it to GHCR, and deploys a preview container — all triggered by PR events:

```yaml
name: Build and Deploy Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

env:
  REGISTRY: ghcr.io

jobs:
  build-and-push:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.REGISTRY }}/${{ github.repository }}
          tags: |
            type=ref,event=pr

      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ${{ steps.meta.outputs.tags }}

  deploy-preview:
    if: github.event.action != 'closed'
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: mieweb/launchpad@main
        with:
          api_key: ${{ secrets.LAUNCHPAD_API_KEY }}
          api_url: ${{ secrets.LAUNCHPAD_API_URL }}
          template_name: ${{ env.REGISTRY }}/${{ github.repository }}:pr-${{ github.event.pull_request.number }}

  cleanup-preview:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: mieweb/launchpad@main
        with:
          api_key: ${{ secrets.LAUNCHPAD_API_KEY }}
          api_url: ${{ secrets.LAUNCHPAD_API_URL }}
```

## Container Access

After deployment, you'll receive access details located in your containers page on manager.os.mieweb.org including:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Container ID        : 136
Internal IP         : 10.15.129.23
Domain Name         : https://my-app-main.os.mieweb.org
SSH Access          : ssh -p 2344 user@my-app-main.os.mieweb.org
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### SSH

```bash
ssh -p <port> <username>@<hostname>.os.mieweb.org
```

## Docker Image Requirements

Your Docker image must:

1. **Be publicly accessible** — The create-a-container server pulls images anonymously. If your image is on GHCR, go to **Package settings > Danger Zone > Change visibility > Public**.
2. **EXPOSE ports** — Declare which ports your application listens on
3. **Use the `org.mieweb.opensource-server.services.http.default-port` label** — Specify the primary HTTP port for reverse proxy configuration

```dockerfile
EXPOSE 3000
LABEL org.mieweb.opensource-server.services.http.default-port=3000
```

The create-a-container server reads these from the image metadata to configure networking and reverse proxy rules automatically.

## Troubleshooting

**Action fails with authentication error:**
- Verify `LAUNCHPAD_API_KEY` secret is set correctly
- Confirm the API key hasn't been revoked

**Deploy step runs but skips container creation:**
- Check the workflow output for the "Create or Locate Container" step — if it's missing, the action version may not support your event type
- Ensure you're using the latest version of `mieweb/launchpad@main`
- Verify the workflow includes the correct `on:` triggers for your use case

**Container not accessible after deploy:**
- Wait 1-2 minutes for background provisioning to complete
- Verify your Docker image exposes the correct port
- Check that the `default-port` label matches your application's listen port

**Container creation fails with `HTTP 401: authentication required`:**
- The Docker image is private. The server pulls images without credentials, so the package must be public.
- On GHCR: go to `https://github.com/users/<owner>/packages/container/<image>/settings` → **Danger Zone** → **Change visibility** → **Public**

**Image not found:**
- Ensure the Docker image was pushed successfully before the deploy step
- Verify the image tag matches between the build and deploy jobs
