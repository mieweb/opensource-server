---
sidebar_position: 5
---

# Docker Images

The project maintains Docker/OCI container images that are automatically built and published to GitHub Container Registry (GHCR). These images serve as base templates for containers created in the Proxmox cluster.

## Available Images

### Base Image (`base`)

The base image includes:
- Debian 13 minimal root filesystem (from Proxmox template)
- SSSD (System Security Services Daemon) for LDAP authentication
- PAM configuration for automatic home directory creation
- Pre-configured for integration with the cluster's LDAP authentication

**Registry Path:** `ghcr.io/mieweb/opensource-server/base`

**Source:** [`images/base/`](https://github.com/mieweb/opensource-server/tree/main/images/base)

## Image Structure

Each image is located in a subdirectory under `images/` in the repository:

```
images/
├── base/
│   ├── Dockerfile
│   ├── sssd.conf
│   └── ldapusers
└── (future images...)
```

Each subdirectory contains:
- **Dockerfile**: The image build instructions
- **Supporting files**: Configuration files, scripts, etc.

## Automated Builds

Images are automatically built and pushed by the [`build-images.yml`](https://github.com/mieweb/opensource-server/blob/main/.github/workflows/build-images.yml) GitHub Actions workflow.

### Build Triggers

Images are built automatically in the following scenarios:

1. **On file changes** - When you push changes to any files within an image's directory (e.g., `images/base/**`)
2. **Weekly schedule** - Every Sunday at 11:00 PM UTC, all images are rebuilt regardless of changes
3. **Manual trigger** - Maintainers can manually trigger builds from the GitHub Actions tab
4. **Tag pushes** - When Git tags are pushed

### Change Detection

The workflow intelligently detects which images need to be built:

- **Push events**: Only images with modified files are rebuilt
- **Scheduled builds**: All images are rebuilt to ensure they have the latest base image updates
- **New branches**: All images are built when a new branch is created

Multiple images can be built in parallel using GitHub Actions matrix strategy.

## Image Tags

Each built image receives multiple tags for flexibility:

| Tag Type | Format | Example | When Applied |
|----------|--------|---------|--------------|
| Commit Hash | `<image>:<commit-hash>` | `base:d00911c6a6f54513aa88683233cd54a673e4ff3d` | Always |
| Branch Name | `<image>:<branch-name>` | `base:main` | On branch pushes |
| Tag Name | `<image>:<tag-name>` | `base:v1.0.0` | On tag pushes |
| Latest | `<image>:latest` | `base:latest` | Only on main branch |

### Example

For the `base` image on commit `d00911c6a6f54513aa88683233cd54a673e4ff3d` on the `main` branch:

```
ghcr.io/mieweb/opensource-server/base:d00911c6a6f54513aa88683233cd54a673e4ff3d
ghcr.io/mieweb/opensource-server/base:main
ghcr.io/mieweb/opensource-server/base:latest
```

## Using Images

### In Container Creation

When creating containers through the web UI, you can specify images using the normalized format:

```
ghcr.io/mieweb/opensource-server/base:latest
ghcr.io/mieweb/opensource-server/base:main
ghcr.io/mieweb/opensource-server/base:d00911c6a6f54513aa88683233cd54a673e4ff3d
```

The system will automatically:
1. Check if the image exists in Proxmox storage
2. Pull the image from GHCR if not cached
3. Create a container from the image

### Pulling Manually

To pull images manually for testing:

```bash
# Authenticate with GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u <username> --password-stdin

# Pull the image
docker pull ghcr.io/mieweb/opensource-server/base:latest

# Run locally for testing
docker run -it ghcr.io/mieweb/opensource-server/base:latest /bin/bash
```

## Adding a New Image

To add a new Docker image to the project:

1. **Create the image directory:**
   ```bash
   mkdir images/myimage
   cd images/myimage
   ```

2. **Add a Dockerfile:**
   ```dockerfile
   FROM ghcr.io/mieweb/opensource-server/base:latest
   
   # Install required packages
   RUN apt-get update && \
       apt-get install -y my-packages && \
       apt-get clean && \
       rm -rf /var/lib/apt/lists/*
   
   # Configure the image
   COPY config-file /etc/myapp/config
   
   CMD ["/usr/bin/myapp"]
   ```

3. **Add supporting files:**
   - Configuration files
   - Scripts
   - Documentation

4. **Test locally:**
   ```bash
   docker build -t myimage:test .
   docker run -it myimage:test
   ```

5. **Commit and push:**
   ```bash
   git add images/myimage/
   git commit -m "Add myimage Docker image"
   git push
   ```

The GitHub Actions workflow will automatically:
- Detect the new image
- Build it
- Push to `ghcr.io/mieweb/opensource-server/myimage:<tags>`

## Local Development

### Building Images Locally

To build and test an image locally before pushing:

```bash
cd images/<image-name>
docker build -t <image-name>:test .
docker run -it <image-name>:test /bin/bash
```

### Testing Image Integration

To test how an image will work in the Proxmox cluster:

1. Build the image locally with the GHCR tag format:
   ```bash
   docker build -t ghcr.io/mieweb/opensource-server/myimage:test .
   ```

2. Push to a test registry or GHCR with a test tag:
   ```bash
   docker tag ghcr.io/mieweb/opensource-server/myimage:test \
              ghcr.io/mieweb/opensource-server/myimage:test-$USER
   docker push ghcr.io/mieweb/opensource-server/myimage:test-$USER
   ```

3. Create a container using the test tag through the web UI

## Build Caching

The workflow uses GitHub Actions cache to speed up builds:

- **Cache scope**: Each image has its own cache scope to avoid conflicts
- **Cache strategy**: `mode=max` exports all layers for maximum reuse
- **Cache storage**: Automatically managed by GitHub Actions

Benefits:
- Faster builds (reuses unchanged layers)
- Reduced network usage
- Lower build minutes consumption

## Monitoring Builds

### Viewing Build Status

1. Go to the [Actions tab](https://github.com/mieweb/opensource-server/actions)
2. Select the "Build and Push Images" workflow
3. View recent runs and their status

### Build Outputs

Each build provides:
- **Step-by-step logs**: Detailed output for each build stage
- **Build summary**: Lists all tags created for each image
- **Error messages**: Clear indication of build failures

### Build Notifications

GitHub will notify you of build failures via:
- Email (if enabled in your GitHub settings)
- GitHub notifications
- Workflow run status badges

## Troubleshooting

### Build Failures

If an image build fails:

1. **Check the logs**: Click on the failed workflow run to see detailed error messages
2. **Test locally**: Build the image locally to reproduce the issue
3. **Check syntax**: Ensure Dockerfile syntax is valid
4. **Verify base images**: Ensure base images (FROM directive) are accessible

### Permission Issues

If pushing to GHCR fails:

- Ensure the repository has the "packages: write" permission (configured in workflow)
- Check that GITHUB_TOKEN has proper permissions
- Verify the repository settings allow GitHub Actions to create packages

### Cache Issues

If builds are slow or failing due to cache:

- Caches are automatically cleaned by GitHub after 7 days of inactivity
- You can manually clear cache by modifying the `cache-from` key in the workflow
- Each image has an isolated cache to prevent cross-contamination

## Best Practices

### Image Design

1. **Minimize layers**: Combine RUN commands to reduce image size
2. **Clean up**: Remove package manager caches and temporary files
3. **Use .dockerignore**: Exclude unnecessary files from build context
4. **Pin versions**: Specify exact package versions for reproducibility
5. **Multi-stage builds**: Use builder stages for compiled software

### Security

1. **Scan images**: Use Docker security scanning tools
2. **Update regularly**: Weekly builds ensure images get security updates
3. **Minimal base**: Start from minimal base images (like Debian minimal)
4. **Non-root users**: Configure containers to run as non-root when possible
5. **Secrets**: Never embed secrets in images (use environment variables)

### Documentation

1. **Document dependencies**: List required packages and their purpose
2. **Explain configuration**: Document configuration files and their options
3. **Provide examples**: Show how to use the image in different scenarios
4. **Update README**: Keep the main images/README.md up to date

## Related Documentation

- [System Architecture](./system-architecture.md) - How images fit into the overall system
- [Development Workflow](./development-workflow.md) - Setting up your development environment
- [Contributing](./contributing.md) - Guidelines for contributing to the project
