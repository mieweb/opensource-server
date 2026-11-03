# opensource-mail-helper

A Postfix [milter](https://www.postfix.org/MILTER_README/) for the mail service (issue #67). It runs pre-queue on the submission ports, listening on a unix socket inside the Postfix chroot, ordered before OpenDKIM so the DKIM signature covers the headers it adds:

- **RCPT**: rejects recipients who one-click-unsubscribed from the authenticated sender (`mail_suppressions_v`) with a synchronous `5.7.1`; database outages defer (fail closed).
- **End of message**: strips client-forged `List-Unsubscribe` headers and, for single-recipient submissions, injects RFC 8058 one-click headers with an encrypted per-recipient token.

## Layout

| Path | Purpose |
|------|---------|
| `src/index.js` | Daemon entry — milter server wiring |
| `src/filter.js` | Decision logic (unit-tested, no milter plumbing) |
| `src/db.js` | Read-only access to the mail views as `mail_postfix` |
| `src/config.js` | `config.json` + `config.local.json` overlay loading |
| `src/unsubscribe-token.js` | Copied from `create-a-container/utils/unsubscribe-token.js` by `make deps` (gitignored) — single source of truth for the token format |
| `config.json` | Committed defaults (not a dpkg conffile) |
| `config.local.json` | Environment overlay, written by the agent's mail service group (gitignored) |

## Build and test

```bash
make deps    # npm ci + sync shared sources
make test    # node --test
make deb     # package (installs to /opt/opensource-server/mail-helper)
```

The package is suggested by `opensource-agent`; the agent enables/starts the unit only on the host holding the mail-host claim. A [self-managed MTA](../mie-opensource-landing/docs/admins/email.md) can run the daemon standalone — it only needs the DB views and the unsubscribe base URL + keys in `config.local.json`.
