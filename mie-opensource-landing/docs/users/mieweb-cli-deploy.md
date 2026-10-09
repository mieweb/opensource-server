# Deploying with the mieweb CLI

`mieweb deploy --target mieweb` deploys a [`@mieweb/cloud`](https://github.com/mieweb/cloud) app (a Cloudflare-Workers-style app described by `wrangler.jsonc`) to an opensource-server site such as os.mieweb.org. The CLI drives the [`@mieweb/os-cloud-provider`](https://github.com/mieweb/opensource-server/tree/main/packages/os-cloud-provider) package, which creates or updates one container per app through the Manager API.

## What gets deployed

Each app gets **one container** on the site, named after `wrangler.jsonc` `name` (it must be a valid DNS label). The container runs the [`cloud` image](../developers/docker-images.md#converged-app-cloud):

- your app, copied from your local worktree and started with its package manager's `start` script (`npm`, `pnpm` or `yarn`, picked from the lockfile) on `$PORT` (default `8787`)
- MinIO, libSQL (`sqld`) and Valkey on `127.0.0.1`, backing the R2, D1/Vectorize and KV/Queue bindings
- a persistent read-write [volume](../admins/core-concepts/volumes.md) at `/mnt/data` for all datastore state

The app is exposed through one HTTP service at `https://<name>.<domain>`; the site's nginx terminates TLS in front of it. The container also publishes SSH (port 22) on a site port, which `deploy` uses to copy your code.

The provider owns the container's services: each deploy makes them match the HTTP service, SSH, and `targets.mieweb.services`. Services added in the web UI, or removed from `services`, are deleted on the next deploy.

Because the container holds your app's secrets and datastore files, **SSH is limited to the container's owner, its collaborators, and the account deploying it** (plus `sshUser`, if set). Other site users can't log in, even though they can SSH into ordinary containers. Sharing changes take effect on the next deploy.

### What `deploy` does

1. **Converge the container** through the Manager API. The first deploy creates it and waits for it to be provisioned. Later deploys change the container only when its configuration differs (services, environment variables, the data volume); otherwise this step makes no changes. If the image (or the GPU requirement) changes, the container is deleted and recreated. `/mnt/data` is kept across that recreate, so datastore contents survive.
2. **Wait for SSH** (retrying for up to 60 s while a new or rebuilt container finishes booting), then **sync your worktree** into `/opt/app/src` in the container (rsync-style: only changed files are sent):
   - Files are sent exactly as they are on disk. Whether a file is committed, staged, or untracked doesn't matter.
   - `.gitignore` rules are honored (including nested `.gitignore` files) and `.git/` is skipped. `.git/info/exclude` and your global git excludes are **not** applied.
   - Files you deleted locally are deleted in the container. Ignored paths in the container, such as `node_modules` and build output, are left alone.
3. **Restart the app** over the same SSH connection and **wait for it**. Dependencies are installed if `package.json` or the lockfile changed, then the `build` script runs if there is one, and their output is shown as it happens. Then the start command runs. `deploy` fails, showing the app's recent logs, if the install or build fails, or if the app stops within 5 seconds of starting.

So a code-only redeploy is just a file sync and a restart.

### SSH credentials

The sync uses a built-in SSH client, so you don't need `ssh` or `rsync` installed. It logs in as your Manager username (override with `targets.mieweb.sshUser` or `MIEWEB_OS_SSH_USER`) and tries your local credentials in this order:

1. your ssh-agent (`SSH_AUTH_SOCK`, or Pageant on Windows)
2. `~/.ssh/id_ed25519`, `id_ecdsa` and `id_rsa`, asking for the passphrase if a key is encrypted
3. your password, asked for in the terminal

Keys work when the public key is on your account. The whole sync uses one connection, so you're asked for a password at most once. With no terminal (e.g. in CI), password login is skipped and deploy fails with a hint unless a key or agent works.

The container's host key is trusted on first connection and pinned in `~/.mieweb/known_hosts`. A changed key is an error, except that the pin is cleared when `deploy` itself recreates the container.

## Setup

Install the provider in your app:

```sh
pnpm add -D @mieweb/os-cloud-provider
```

Point the `mieweb` target at it in `mieweb.jsonc`:

```jsonc
{
  "targets": {
    "mieweb": {
      "provider": "@mieweb/os-cloud-provider",
      // The Manager site to deploy into. Optional: if omitted, deploy uses the
      // only site you can see, or asks (in a terminal) and saves your choice
      // here. MIEWEB_OS_SITE_ID overrides it.
      "siteId": 1,
      "instanceUrl": "https://os.mieweb.org",   // optional (default)
      // Everything below is optional.
      "image": "ghcr.io/mieweb/opensource-server/cloud:main", // default: the cloud image of the same release as the provider; set a :<branch>/:sha-<sha> tag to test
      "port": 8787,                  // port the app listens on ($PORT)
      "domain": "os.mieweb.org",     // external domain (name or id); default: the site's first
      "externalHostname": "my-app",  // default: wrangler.jsonc `name`
      "authRequired": false,         // put the site's auth proxy in front of the app
      "start": "npm run serve",      // start command (default: `<npm|pnpm|yarn> run start`)
      "sshUser": "alice",            // default: your Manager username
      "sshHost": "203.0.113.10",     // default: the container's published SSH host
      "sync": true,                  // false: converge the container only, don't copy code
      "services": [{ "type": "udp", "internalPort": 5060 }] // extra tcp/udp/srv services (SSH is always added)
    }
  }
}
```

`mieweb.jsonc` holds **no secrets**.

## Authentication

Either set a token in the environment (CI):

```sh
export MIEWEB_OS_TOKEN=<API key>          # create one under API Keys in the web UI
export MIEWEB_OS_URL=https://os.mieweb.org # optional; overrides instanceUrl
mieweb deploy --target mieweb
```

or log in interactively:

```sh
mieweb login --target mieweb [--instance https://os.mieweb.org]
```

`login` opens your browser to the Manager. After you sign in and confirm, the browser passes a short-lived, single-use sign-in code to a temporary listener the CLI runs on `127.0.0.1`. The CLI then exchanges that code directly with the Manager for an API key; the key itself never passes through the browser. A code that isn't redeemed within two minutes expires without creating a key. The key is stored in `~/.mieweb/os.json` (mode `0600`), keyed by instance, so you can stay logged in to several instances at once. `mieweb logout --target mieweb` revokes the key and removes it from that file. `mieweb whoami --target mieweb` shows who you are signed in as.

`MIEWEB_OS_TOKEN` always takes precedence over the stored login.

## Environment variables in the container

The container's environment is replaced on every deploy with:

| Source | Variables |
| --- | --- |
| `wrangler.jsonc` `vars` | as declared (non-string values are JSON-encoded) |
| `MIEWEB_OS_SECRET_<NAME>` in the deploying shell | `<NAME>` (for secrets, e.g. `MIEWEB_OS_SECRET_API_KEY` → `API_KEY`) |
| Provider-managed | `PORT`, `MIEWEB_TARGET`, `MIEWEB_APP_START`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MIEWEB_S3_ENDPOINT`, `MIEWEB_S3_ACCESS_KEY_ID`, `MIEWEB_S3_SECRET_ACCESS_KEY`, `MIEWEB_LIBSQL_URL`, `MIEWEB_VALKEY_URL`, `MIEWEB_SSH_ALLOW_USERS` |
| Provider defaults (only if the app doesn't set them) | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (the MinIO credentials, so S3 clients using the default credential chain, such as the `s3` binding driver, reach the local MinIO) and `AWS_REGION` (`us-east-1`) |

Values reach the app exactly as given, including quotes, backslashes, `$` and JSON. Names must be letters, digits and `_` (not starting with a digit, and not `__proto__`), and values can't contain line breaks; base64-encode multi-line secrets such as PEM keys. `deploy` fails rather than silently dropping anything.

The MinIO password is generated on the first deploy and reused after that. Variables added to the container through the web UI are removed on the next deploy.

## Other commands

| Command | Behavior |
| --- | --- |
| `mieweb destroy --target mieweb` | Deletes the container. The `/mnt/data` directory is kept on the site's shared volume storage and reattached when the **same owner** deploys the **same name** to the **same site** again; a different owner gets an empty one. |
| `mieweb dev --target mieweb` | Not provided by this provider (there's no remote dev mode). Use the local host harness. |
| `mieweb tail --target mieweb` | Streams the app's logs (`journalctl -u app.service`) over the same SSH connection deploy uses, so the same credentials apply. Shows the last 100 lines and keeps following until Ctrl-C. Options: `-n`/`--lines N`, `--no-follow`, and `--since <time>` (e.g. `-1h`, `"2026-10-01 12:00"`). |

## Testing against a local Manager

`make dev` runs the Manager at `http://localhost:3000` on SQLite with a simulated hypervisor and a seeded `localhost` site (id `1`). Create an API key in its UI, then:

```sh
MIEWEB_OS_URL=http://localhost:3000 MIEWEB_OS_TOKEN=<key> mieweb deploy --target mieweb
```

The simulated hypervisor has no real SSH endpoint, so set `"sync": false` for this loop. The provider's live test suite (`pnpm test:live` in `packages/os-cloud-provider`) runs the same loop.
