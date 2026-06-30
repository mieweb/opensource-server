# proxy-auth-lib release scripts

Each script publishes one language package to its registry. They are the same
commands CI runs (see [`.github/workflows/proxy-auth-lib-release.yml`](../../.github/workflows/proxy-auth-lib-release.yml)),
so a release can be reproduced or debugged locally.

All scripts take the release version as their first argument and call
[`stamp-version.sh`](stamp-version.sh) first, which writes that single version
into every package manifest (npm, JSR, PyPI, crates.io, Meteor). The Go module
has no version field — it is released by a git tag.

| Script | Registry | Auth |
| --- | --- | --- |
| `publish-npm.sh` | npm (`@mieweb/trusted-proxy-auth`) | `NODE_AUTH_TOKEN` |
| `publish-jsr.sh` | JSR (`@mieweb/trusted-proxy-auth`) | OIDC in CI / browser locally |
| `build-pypi.sh` | builds dist for PyPI (`trusted-proxy-auth`) | upload via OIDC in CI / token locally |
| `publish-crates.sh` | crates.io (`trusted-proxy-auth`) | `CARGO_REGISTRY_TOKEN` |
| `publish-meteor.sh` | Atmosphere (`mieweb:accounts-proxy-auth`) | `meteor login` / `METEOR_SESSION` |
| `publish-go.sh` | Go proxy (`.../proxy-auth-lib/go`) | git tag push |
| `smoke-runtimes.sh` | installs published npm package under Bun and Deno | none |

```bash
# Local dry run of a single registry (example: npm)
NODE_AUTH_TOKEN=*** ./publish-npm.sh 1.2.3
```

The first Meteor publish needs the package created:

```bash
./publish-meteor.sh 1.2.3 --create
```
