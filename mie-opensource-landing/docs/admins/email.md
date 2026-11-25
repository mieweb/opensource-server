# Email Service

Authenticated SMTP submission + IMAP hosted by an agent (Postfix + Dovecot + OpenDKIM, + PostSRSd for forwarding), with DKIM signing, per-domain enablement, per-account forwarding, and RFC 8058 one-click unsubscribe. User-facing usage is covered in [Email Accounts](../users/email-accounts.md); per-domain DNS setup in [External Domains](core-concepts/external-domains.md#mail).

## The Mail Host

Exactly one agent runs the mail stack at a time (mailboxes are local Maildir). The claim goes to the first agent that checks in with the `mail` service group enabled and all packages installed; other agents show **Standby** on the Agents page. Release the claim from the Agents page (**Release mail host**) — the next qualifying check-in takes it.

The mail IP is the `externalIp` of the mail host's site. Dovecot and Postfix read accounts **live** from the manager's database through read-only views (`mail_accounts_v`, `mail_senders_v`, `mail_recipients_v`, `mail_suppressions_v`, `mail_forwards_v`), so disabling an account or domain, or changing its forwards, takes effect immediately (bounded by Dovecot's 1-minute auth cache).

## Forwarding and SRS

Forwarded copies leave the mail host with the original sender's envelope address, which fails SPF at the destination. The agent runs `postsrsd` (part of the mail stack packages): foreign envelope senders are rewritten to `SRS0=…@<Mail hostname>`, and bounces to those addresses are reversed to the original sender. Senders on your own mail domains are never rewritten.

- SRS needs the **Mail hostname** setting; without it forwarding still works, unrewritten.
- Publish an SPF record for the mail hostname: `<mail hostname>. TXT "v=spf1 a -all"` (or `ip4:<mail IP>`; add the relay's include when using a relayhost).
- The agent adds the mail hostname to the accepted domains so SRS bounces are delivered.
- Side effect: inbound mail from outside senders shows an `SRS0=` `Return-Path` in mailboxes too.

## Settings

Settings → Mail service:

| Setting | Purpose |
|---------|---------|
| Mail hostname | HELO name and MX target. Set to the forward-confirmed PTR of the mail IP — use **Suggest from PTR**. |
| Relayhost (+ credentials) | Optional smarthost. Requires **SPF include**, since mail then leaves from the relay's IPs |
| SPF include | `include:` added to the suggested SPF records |
| DNS check resolvers | Resolvers used by Check DNS (default `1.1.1.1`, `8.8.8.8`) |
| Mail DB host | Only when the mail host cannot reach the DB over the local socket |
| Self-managed site id | Mail IP source when no agent runs mail (option C below) |
| Default quota / message size limit | `1024` MB and `25` MB when empty |

One-click unsubscribe links (`<manager>/u/<token>`) use the mail host agent's `MANAGER_URL` as the base — set it to the manager's public URL.

## Where Mail Runs

**A. Manager (default).** The manager image ships the packages and sets `AGENT_SERVICES=nginx,dnsmasq,mail`. DB access uses Postgres peer auth (`pg_ident` maps the `postfix`/`dovecot`/`opensource-mail` OS users to the `mail_postfix`/`mail_dovecot` roles) — no passwords.

**B. Another agent host.**

1. Install the suggested packages: `apt install opensource-mail-helper postfix postfix-pgsql dovecot-core dovecot-imapd dovecot-lmtpd dovecot-pgsql opendkim postsrsd` (use the `-mysql` variants on MySQL/MariaDB).
2. Install the per-domain certs under `/etc/ssl` (same layout as nginx).
3. Set the **Mail DB host** setting, give the `mail_postfix`/`mail_dovecot` roles passwords (`ALTER ROLE mail_postfix WITH PASSWORD '...'`), and put `MAIL_POSTFIX_DB_PASSWORD` / `MAIL_DOVECOT_DB_PASSWORD` in the agent's `/etc/environment`.
4. Make sure the agent checks in over HTTPS — the manager refuses to send the mail snapshot (DKIM keys, relay credentials) over plaintext (`insecure_transport`).
5. Remove `mail` from the manager's `AGENT_SERVICES`, add it on the new host (see [Deploying Agents](deploying-agents.md)). It takes the claim.
6. `rsync /var/vmail` from the old host.
7. Repoint the port forwards (25, 143, 465, 587, 993) and re-run Check DNS on each domain — the mail IP follows the host's site automatically.

**C. Self-managed MTA (no agent runs `mail`).**

1. Set **Self-managed site id** to the site whose `externalIp` sends mail.
2. Point Dovecot at `mail_accounts_v` and Postfix at `mail_senders_v` + `mail_recipients_v` (+ `mail_forwards_v` as `virtual_alias_maps` for forwarding), with Dovecot's `quota-status` guarding RCPT. The views are a documented, stable contract — see [Database Schema](../developers/database-schema.md#mail-views).
3. Export DKIM keys per domain (`GET /api/v1/external-domains/{id}/mail/dkim` — admin-only, audited in the manager log) and use the agent templates under `agent/templates/mail/` as a reference. Run the `opensource-mail-helper` milter yourself for suppressions + unsubscribe headers (it only needs the DB views and the unsubscribe keys in its `config.local.json`), or skip them.

## DB Roles

Migration `20261012000000` creates the read-only `mail_dovecot` and `mail_postfix` roles and grants SELECT on the views; `20261119000000` re-runs it for managers that predate the mail stack. On a local Postgres cluster the `opensource-server` package (install and every upgrade) grants the app user `CREATEROLE` and adds the `pg_hba`/`pg_ident` peer maps; elsewhere the migration logs the SQL for a DBA. Local mail hosts authenticate over the socket (Postgres peer via `pg_ident`); remote hosts need operator-set passwords (`ALTER ROLE … WITH PASSWORD`).

## Backups

Everything except mailbox content lives in the manager database (accounts, DKIM keys, suppressions, unsubscribe keys) — covered by your normal DB backup. Mailboxes are Maildirs under `/var/vmail/<account-id>` on the mail host; back that directory up separately. Deleted accounts' Maildirs are garbage-collected 30 days after deletion.
