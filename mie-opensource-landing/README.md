# MIE Open Source Landing Page

A modern, responsive landing page showcasing MIE's open source initiatives, built with [Docusaurus](https://docusaurus.io/). Features container management tools, Proxmox Launchpad CI/CD integration, and comprehensive documentation.

## Configuration for Self-Hosted Deployments

This documentation site is designed to work for both MIE's hosted deployment and self-hosted instances. URLs for Proxmox and container creation services are parameterized.

### Environment Variables

Copy `.env.example` to `.env` and update the URLs for your deployment:

```bash
cp .env.example .env
```

Then edit `.env` with your instance URLs:

```env
# Your Proxmox Web GUI URL
PROXMOX_URL=https://your-proxmox-server:8006

# Your Container Creation Web GUI URL
CONTAINER_CREATION_URL=https://your-container-creation-url.com
```

These URLs will be used throughout the documentation and site interface automatically.