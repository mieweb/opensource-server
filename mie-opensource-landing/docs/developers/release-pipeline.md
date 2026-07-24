# Release Pipeline

{{ contributor_warning }}

The four deployable components are packaged as Debian packages and published
to GitHub Releases as a flat APT repository. The same component build commands
are reused by local development, the container images, and CI.

## Components and packages

| Directory | Package | Arch | Contents |
|---|---|---|---|
| [`create-a-container/`](https://github.com/mieweb/opensource-server/tree/main/create-a-container) | `opensource-server` | amd64 | Manager web app, job runner, systemd units |
| [`mie-opensource-landing/`](https://github.com/mieweb/opensource-server/tree/main/mie-opensource-landing) | `opensource-docs` | all | Prebuilt documentation site |
| [`agent/`](https://github.com/mieweb/opensource-server/tree/main/agent) | `opensource-agent` | all | Check-in agent, config templates, systemd timer, error pages |
| [`manager-control-program/`](https://github.com/mieweb/opensource-server/tree/main/manager-control-program) | `opensource-mcp` | amd64 | MCP server with vendored Python deps, systemd unit |

Everything installs under the `/opt/opensource-server` prefix, matching the
paths referenced by the systemd units and the agent-rendered nginx
configuration. `opensource-server` depends on
`opensource-agent` and `opensource-docs` because the manager's nginx config
serves the agent's error pages and the docs site, and on `opensource-mcp`,
whose MCP service the manager reverse-proxies at `/mcp`.

## The component Makefile contract

Each component directory has a self-contained `Makefile` with the same targets.
The default goal is `help`, which lists the available targets.

| Target | Description |
|---|---|
| `help` | List the available targets (default goal) |
| `deps` | Install build/runtime dependencies (`npm ci`, `uv sync`, or nothing) |
| `build` | Compile the component; depends on `deps` |
| `install` | Stage built files into `DESTDIR` at their final paths; depends on `build` |
| `dev` | Run the development watch loop; depends on `deps` |
| `deb` / `rpm` / `apk` | Stage and package with [fpm](https://fpm.readthedocs.io/); depend on `install` |

Variables (overridable):

| Variable | Default | Meaning |
|---|---|---|
| `PREFIX` | `/opt/opensource-server` | Vendor install prefix |
| `DESTDIR` | `/` | Staging root for `install` |

The package version is derived from git by [`./package-version`](https://github.com/mieweb/opensource-server/blob/main/package-version),
which composes a format-appropriate string per packager from
`git describe --tags --long --dirty`: an exact tag `2026.6.3` is used as-is;
commits after a tag become a snapshot that sorts above the tag and below the
next release (e.g. deb `2026.6.3+<n>.g<sha>`); a prerelease tag `2026.6.3-rc1`
sorts below the eventual `2026.6.3`. A leading `v` on the tag is optional — it
is stripped if present (`v2026.6.3` and `2026.6.3` are equivalent).

```bash
# Build and stage a component anywhere:
make -C agent install DESTDIR=/tmp/agent-root

# Build one package:
make -C create-a-container deb        # -> create-a-container/*.deb

# Build all three and collect them into ./dist:
make deb
```

The top-level `Makefile` simply forwards these targets to every component and collects the packages into `dist/`.

## Development

Each component's `dev` target runs it locally:

```bash
make -C create-a-container dev        # Manager on localhost (SQLite, no Proxmox); see the Development Workflow guide
make -C mie-opensource-landing dev    # docs live server
```

`make dev` at the repo root delegates to `create-a-container`.

## Packaging with fpm

Each component has a `.fpm` options file holding the static package metadata (name, architecture, dependencies, description, scripts, config files). The Makefile's `package` target stages the component into a `.pkg/buildroot` and runs [fpm](https://fpm.readthedocs.io/) with the dynamic options on the command line — output type, version (composed per format by `./package-version`), and the staging dir. fpm's `dir` input copies the staged tree verbatim from `-C .pkg/buildroot`, preserving symlinks (e.g. `node_modules/.bin/sequelize`) and the directory layout. The same definition produces deb, rpm, and apk, so `make rpm` and `make apk` also work.

- `opensource-server` ships the `container-creator` and `job-runner` systemd units and enables them via an `after-install` script (`before-remove` disables them on real removal). The log directory is created on demand by the unit's `LogsDirectory`, not shipped in the package. The logrotate drop-in is the only config file. The `container-creator-init` unit (which provisions a *local* PostgreSQL) is **not** in the package — it is part of the manager image, since the package only suggests postgresql and works with a remote database too.
- `opensource-agent` ships the compiled check-in agent, its config templates, the systemd service + 30s timer (enabled via an `after-install` script) and the static error pages. These are program code, not configuration (runtime config comes from `/etc/environment`), so nothing is marked as a config file.
- `opensource-docs` ships content only.

Config files are marked explicitly with `--config-files`; `--deb-no-default-config-files` stops fpm/dpkg from auto-marking everything under `/etc` as a conffile.

## Container images

The [`builder`](https://github.com/mieweb/opensource-server/blob/main/images/builder/Dockerfile) image runs `make deb` (Node.js, uv, and fpm) to produce all three packages, exported as an artifact-only stage. The `docs`, `agent`, and `manager` images install those packages via a Docker Bake `builder` context instead of copying the repository. The packages are bind-mounted (no extra image layer):

```dockerfile
RUN --mount=from=builder,source=/dist,target=/dist \
    apt-get update && \
    apt-get install -y /dist/opensource-agent_*.deb
```

Each leaf image also stages the release APT source (`/etc/apt/sources.list.d/opensource-server.sources`) so a running container picks up future releases with `apt upgrade`. The source stays in place for the whole build which is normally not an issue since the local builder would have built a newer version than what's available in the repo.

## Releases

To cut a release, **publish a GitHub release** (full or prerelease) for a semver tag — the leading `v` is optional (e.g. `2026.6.3` or `v2026.6.3`, and `2026.6.3-rc1` for a prerelease). Publishing the release triggers [`release.yml`](https://github.com/mieweb/opensource-server/blob/main/.github/workflows/release.yml), which builds the packages, generates flat APT repository metadata (`Packages`, `Packages.gz`) with `dpkg-scanpackages`, and uploads the debs and metadata to that release. The workflow never creates or modifies the release itself — you choose full vs prerelease when creating it. Because GitHub serves `releases/latest/download/<file>` for the newest non-prerelease release, the release doubles as an apt source:

```text
deb [trusted=yes] https://github.com/mieweb/opensource-server/releases/latest/download/ ./
```

Image tagging follows the same rule: `:latest` is published only when a **non-prerelease** release is published, keeping the `:latest` image channel aligned with the `releases/latest` package channel. Pre-releases publish their own assets and `:X.Y.Z` image tags without moving `:latest`.

## Installing and updating on a host

```bash
# One-off install (stable URL):
curl -fsSLO https://github.com/mieweb/opensource-server/releases/latest/download/opensource-agent_latest.deb
apt install -y ./opensource-agent_latest.deb

# Or add the apt source once, then use apt normally:
cat >/etc/apt/sources.list.d/opensource-server.sources <<'EOF'
Types: deb
URIs: https://github.com/mieweb/opensource-server/releases/latest/download/
Suites: ./
Trusted: yes
EOF
apt update && apt install opensource-server
```
