# Email Accounts

Send mail over authenticated SMTP and read replies over IMAP from any app in the environment — no external mail provider needed. Manage accounts under **Email** in the sidebar.

## Creating an Account

1. **Email → New email account**, pick a domain (only domains an admin has [enabled for mail](../admins/core-concepts/external-domains.md#mail) appear) and a local part, e.g. `my-app@example.com`.
2. Copy the generated password — it is shown **once**. Use **Rotate password** to get a new one at any time (the old one stops working immediately).

Role addresses (`postmaster`, `abuse`, `noreply`, `admin`, …) are reserved for administrators.

## Client Settings

| | |
|---|---|
| Username | the full address (e.g. `my-app@example.com`) |
| SMTP | port `587` (STARTTLS) or `465` (implicit TLS) — authentication required, TLS always |
| IMAP | port `993` (TLS) or `143` |

```bash
# Quick smoke test
curl --ssl-reqd --url smtp://example.com:587 \
  --user 'my-app@example.com:<password>' \
  --mail-from my-app@example.com --mail-rcpt you@example.net \
  --upload-file message.eml
```

Mail is DKIM-signed automatically. You can only send from your own address — the envelope sender must match your login.

## Unsubscribe Headers and Suppressions

Outbound mail gets RFC 8058 `List-Unsubscribe` headers by default, so recipients can one-click unsubscribe (Gmail and others surface this as an "Unsubscribe" button). Per account:

- **Unsubscribe headers** toggle — turn the headers off for purely transactional accounts.
- **Suppressions** — recipients who unsubscribed. Further mail from this account to them is rejected synchronously at submission (`5.7.1`), so your app sees the error instead of silently dropped mail. Only admins can remove a suppression.

## Limits

- Sending works only while the domain can send (admin-controlled, DNS-verified). If the domain is disabled, SMTP login is refused but IMAP stays readable.
- Mailboxes have a quota (shown in the list); over-quota delivery is rejected at RCPT.
- Disabled or deleted accounts stop authenticating immediately. A deleted account's mailbox is kept for 30 days.
