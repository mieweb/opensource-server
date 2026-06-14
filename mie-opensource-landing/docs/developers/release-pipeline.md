# Release Pipeline

The three deployable components are packaged as Debian packages and published
to GitHub Releases as a flat APT repository. The same component build commands
are reused by local development, the container images, and CI.

## Components and packages

| Directory | Package | Arch | Contents |
|---|---|---|---|
| [`create-a-container/`](https://github.com/mieweb/opensource-server/tree/main/create-a-container) | `opensource-server` | amd64 | Manager web app, job runner, systemd units |
| [`mie-opensource-landing/`](https://github.com/mieweb/opensource-server/tree/main/mie-opensource-landing) | `opensource-docs` | all | Prebuilt documentation site |
| [`pull-config/`](https://github.com/mieweb/opensource-server/tree/main/pull-config) | `opensource-agent` | all | pull-config engine, instances, error pages |

Everything installs under the `/opt/opensource-server` prefix, matching the
paths referenced by the systemd units, the pull-config instances, and the
manager-rendered nginx configuration. `opensource-server` depends on
`opensource-agent` and `opensource-docs` because the manager's nginx config
serves the agent's error pages and the docs site.

## The component Makefile contract

Each component directory has a self-contained `Makefile` with the same targets.
The default goal is `build`.

| Target | Description |
|---|---|
| `deps` | Install build/runtime dependencies (`npm ci`, `uv sync`, or nothing) |
| `build` | Compile the component (default goal); depends on `deps` |
| `install` | Stage built files into `DESTDIR` at their final paths; depends on `build` |
| `dev` | Run the development watch loop; depends on `deps` |
| `deb` / `rpm` / `apk` | Stage and package with [nfpm](https://nfpm.goreleaser.com); depend on `install` |

Variables (overridable):

| Variable | Default | Meaning |
|---|---|---|
| `PREFIX` | `/opt/opensource-server` | Vendor install prefix |
| `DESTDIR` | `/` | Staging root for `install` |
| `VERSION` | derived from `git describe` | Package version |

`VERSION` is computed inline from git tags: an exact tag `2026.6.2` is used
as-is; commits after a tag become `2026.6.2+<n>.g<sha>` (valid semver build
metadata that sorts above the tag and below the next release); a prerelease tag
`2026.6.3-rc1` sorts below the eventual `2026.6.3`. Tags are unprefixed semver
(no leading `v`).

```bash
# Build and stage a component anywhere:
make -C pull-config install DESTDIR=/tmp/agent-root

# Build one package:
make -C create-a-container deb        # -> create-a-container/*.deb

# Build all three and collect them into ./dist:
make deb
```

The top-level `Makefile` simply forwards these targets to every component and
collects the packages into `dist/`.

## Development

`make dev` runs the long-running watch loops:

```bash
make -C create-a-container dev        # server (nodemon) + client (vite watch)
make -C create-a-container dev-client # client bundle watcher only
make -C mie-opensource-landing dev    # docs live server
```

The local development stack ([`compose.yml`](https://github.com/mieweb/opensource-server/blob/main/compose.yml))
uses these same targets: the `client` service runs `make dev-client` (the
server runs inside the Proxmox container) and the `zensical` service runs
`make dev`.

## Packaging with nfpm

Each component has an `nfpm.yaml` that packages the staged tree (`type: tree`)
plus any config files and maintainer scripts. nfpm produces deb, rpm, and apk
from the same definition, so `make rpm` and `make apk` also work.

- `opensource-server` ships the `container-creator` and `job-runner` systemd
  units and enables them via an nfpm `postinstall` script (`preremove` disables
  them on real removal). The log directory is created on demand by the unit's
  `LogsDirectory`, not shipped in the package. The logrotate drop-in is a config
  file. The `container-creator-init` unit (which provisions a *local*
  PostgreSQL) is **not** in the package — it is part of the manager image, since
  the package only suggests postgresql and works with a remote database too.
- `opensource-agent` ships the pull-config instances and cron schedule as
  config files so admin customizations survive upgrades.
- `opensource-docs` ships content only.

Each `nfpm.yaml` declares its `/etc` files explicitly as `config` and packages
the rest of the staged tree per top-level directory (`/opt`, `/usr`, `/var`).
This keeps conffile tagging without any file appearing in both a `tree` and a
`config` entry (which nfpm rejects), so `make install` and `make package` never
fight. `make package` reuses the `DESTDIR` install in `build-root` rather than
mutating it — run `make clean` first for a guaranteed-pristine package.

## Container images

The [`builder`](https://github.com/mieweb/opensource-server/blob/main/images/builder/Dockerfile)
image runs `make deb` (Node.js, uv, and nfpm) to produce all three packages,
exported as an artifact-only stage. The `docs`, `agent`, and `manager` images
install those packages via a Docker Bake `builder` context instead of copying
the repository. The packages are bind-mounted (no extra image layer):

```dockerfile
RUN --mount=from=builder,source=/dist,target=/dist \
    { apt-get update || true; } && \
    apt-get install -y /dist/opensource-agent_*.deb
```

Each leaf image also stages the release APT source
(`/etc/apt/sources.list.d/opensource-server.sources`) so a running container
picks up future releases with `apt upgrade`. The source stays in place for the
whole build; a missing release is a non-fatal `apt update` warning (hence the
`|| true`).

## Releases

To cut a release, **publish a GitHub release** (full or prerelease) for an
unprefixed semver tag (e.g. `2026.6.3`, or `2026.6.3-rc1` for a prerelease).
Publishing the release triggers
[`release.yml`](https://github.com/mieweb/opensource-server/blob/main/.github/workflows/release.yml),
which builds the packages, generates flat APT repository metadata (`Packages`,
`Packages.gz`) with `dpkg-scanpackages`, and uploads the debs and metadata to
that release. The workflow never creates or modifies the release itself — you
choose full vs prerelease when creating it. Because GitHub serves
`releases/latest/download/<file>` for the newest non-prerelease release, the
release doubles as an apt source:

```text
deb [trusted=yes] https://github.com/mieweb/opensource-server/releases/latest/download/ ./
```

Image tagging follows the same rule: `:latest` is published only when a
**non-prerelease** release is published, keeping the `:latest` image channel
aligned with the `releases/latest` package channel. Pre-releases publish their
own assets and `:X.Y.Z` image tags without moving `:latest`.

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
