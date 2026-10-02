# `@mieweb/os-cloud-provider`

The opensource-server (os.mieweb.org) implementation of the
[`@mieweb/deploy-contract`](https://github.com/mieweb/cloud/tree/main/packages/deploy-contract)
`DeployProvider`. With it, `mieweb deploy --target mieweb` creates or updates
one container per app through the Manager API.

User documentation: [Deploying with the mieweb CLI](../../mie-opensource-landing/docs/users/mieweb-cli-deploy.md).
Example config: [`examples/mieweb.jsonc`](examples/mieweb.jsonc).

| Verb | Manager operations |
| --- | --- |
| `deploy` | `list_containers?hostname=` → `create_container` (409 → retry as update) \| `update_container` (only when config differs) \| `delete_container`+`create_container` when the image or GPU requirement changes; poll `get_job`; `get_container` for the URL, VMID and SSH port; then wait for SSH and sync the worktree (honoring `.gitignore`) into `/opt/app/src` and restart `app.service` over SSH |
| `destroy` | `delete_container` (the `/mnt/data` volume is retained) |
| `whoami` | `get_session` |
| `login` / `logout` | `/api/v1/auth/cli/callback` loopback handoff / `delete_api_key` |
| `tail` | `get_container` for the SSH port, then `sudo journalctl -u app.service -f` over SSH (`-n/--lines N`, `--no-follow`, `--since <time>`) |
| `dev` | not implemented (there's no remote dev mode) |

`DeployResult.resources` holds one `{ kind: 'container', binding: <name>, id: <VMID> }`.

## Development

Node ≥ 22.18 runs the TypeScript sources directly (type stripping), so there's
no build step during development. The source uses only erasable syntax, and
relative imports end in `.ts`.

```sh
pnpm install
pnpm test          # unit + contract conformance against an in-process fake Manager
pnpm typecheck
pnpm build         # tsc → dist/ (ESM .js + .d.ts), run automatically on pack/publish
pnpm gen:types     # regenerate src/generated/manager-api.ts from the Manager's OpenAPI spec
```

The code sync is pure JavaScript. It uses [`ssh2`](https://www.npmjs.com/package/ssh2) for SSH, [`ignore`](https://www.npmjs.com/package/ignore) for `.gitignore` rules, and [`tar-stream`](https://www.npmjs.com/package/tar-stream) for the upload, so no local `ssh` or `rsync` is needed. Authentication tries ssh-agent, then `~/.ssh/id_{ed25519,ecdsa,rsa}` (prompting for a passphrase if the key is encrypted), then keyboard-interactive or password prompts. `src/sync.ts` diffs the files by size and mtime, streams the changed ones as a tar into `sudo tar -x`, deletes removed files, and restarts the app. Tests drive it against an in-process `ssh2` server (`test/ssh.test.ts`) and a fake remote shell backed by a directory (`test/sync.test.ts`).

Live test against a real Manager (the code sync is disabled there, since DummyApi containers have no SSH) (`make dev` at the repo root: SQLite plus the
DummyApi hypervisor):

```sh
MIEWEB_OS_LIVE=1 MIEWEB_OS_URL=http://localhost:3000 MIEWEB_OS_TOKEN=<key> \
  MIEWEB_OS_SITE_ID=1 pnpm test:live
```

For a full end-to-end run on real Proxmox (the top-level `compose.yml` stack),
build `images/cloud` locally and stage it into the Proxmox template cache with
the stack's existing local-first skopeo pattern
(`skopeo copy docker-daemon:<image> … || skopeo copy docker://<image> …`). Then
set `targets.mieweb.image` to that reference and deploy. That run needs a
privileged host, so keep it behind a CI gate.

`@mieweb/deploy-contract` is not published to npm yet. It's a regular dependency installed with pnpm's subdirectory git syntax, pinned to a commit of mieweb/cloud#14:
`github:mieweb/cloud#<sha>&path:/packages/deploy-contract`. Install the provider with pnpm, because npm can't resolve that specifier. Once the contract is published, switch it to a semver range (`^0.2.1`).
