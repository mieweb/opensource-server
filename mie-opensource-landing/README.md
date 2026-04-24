# Opensource at MIE - Documentation

Documentation site for MIE's opensource Proxmox cluster, built with [Zensical](https://zensical.org/) and [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/).

## Quick Start

```bash
uv sync
uv run zensical serve
```

Open http://localhost:8000 to preview the site.

## Build

```bash
uv run zensical build
```

Output is in the `site/` directory.