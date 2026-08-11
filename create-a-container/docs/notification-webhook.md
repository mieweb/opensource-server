# Notification webhook contract

Node-side tools (e.g. `lxc-oomd`) report events to the `create-a-container`
manager over an authenticated HTTP webhook. The manager persists each event and
surfaces it to the owning user in the UI notification bell.

This is the integration target for the `lxc-oomd` packaged hook script (see
issue #431 / #434).

## Endpoint

```
POST /api/v1/notifications
Authorization: Bearer <admin-api-key>
Content-Type: application/json
```

Authentication is an **admin API key** (mint one on the API Keys page as an
admin user). Non-admin keys receive `403`; missing/invalid keys receive `401`.

The read/acknowledge endpoints (`GET /api/v1/notifications`,
`POST /api/v1/notifications/all/ack`, `POST /api/v1/notifications/{id}/ack`) are
owner-scoped and used by the web UI; the hook script only needs the `POST`
above.

## Payload

```jsonc
{
  "source": "lxc-oomd",                 // required. Emitter name.
  "severity": "critical",               // required. one of: info | warning | critical
  "node": "opensource-phxdc-pve1",      // optional. hypervisor node name
  "ctid": 392,                          // optional. container id (int or string)
  "owner": "mbachelder",                // optional. Users.uid; see "Owner resolution"
  "action": "freeze",                   // optional. freeze | kill | bump | quarantine | detect | ...
  "message": "CT 392 frozen: memory PSI full avg10=83 for 45s",  // required
  "evidence": {                         // optional. free-form structured detail
    "psiFullAvg10": 83.6,
    "refaultRate": "...",
    "topProcs": ["..."]
  },
  "ts": 1771234560                      // optional. epoch seconds; stored as eventAt
}
```

Field notes:

- **`severity`** must be one of `info`, `warning`, `critical`. Anything else is
  a `400`.
- **`ctid`** accepts a number or string and is stored as a string (matching the
  hypervisor container id).
- **`ts`** is epoch **seconds** (not milliseconds); the manager records it as
  `eventAt`. When omitted, `eventAt` is null and only the server receipt time
  (`createdAt`) is available.
- **`evidence`** is stored verbatim as JSON; put anything not covered by a
  first-class field here.
- Unknown top-level keys are ignored.

## Owner resolution

Visibility in the UI is per-owner: a user sees only notifications whose `owner`
matches their username (`Users.uid`).

- If the payload includes `owner`, it is used as-is.
- If `owner` is omitted, the manager resolves it best-effort from `node` +
  `ctid` via the Containers table (node name → node, then `containerId` on that
  node → owning `username`).
- If resolution fails (unknown node/ctid), the event is **still stored** with a
  null owner. It will not appear in any user's bell. Prefer sending an explicit
  `owner`, or a resolvable `node` + `ctid`, when the event should reach a human.

## Example

```sh
curl -sS -X POST https://<manager-host>/api/v1/notifications \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "lxc-oomd",
    "severity": "critical",
    "node": "opensource-phxdc-pve1",
    "ctid": 392,
    "action": "freeze",
    "message": "CT 392 frozen: memory PSI full avg10=83 for 45s",
    "evidence": { "psiFullAvg10": 83.6 },
    "ts": '"$(date +%s)"'
  }'
```

A `201` response returns the persisted notification (including the assigned
`id` and the resolved `owner`) so the caller can log it.
