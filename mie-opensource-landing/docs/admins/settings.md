---
sidebar_position: 7
---

# System Settings

Admin-only system-wide configuration. Access via **Settings** in the admin sidebar.

![Settings Page](/img/screenshots/settings-page.png)

## Email (SMTP)

Configure SMTP for password resets and system notifications.

- **SMTP URL**: `smtp[s]://[[user][:pass]@]<host>[:port]`
- **No-Reply Email**: "From" address for system emails (e.g., `noreply@example.com`)

When configured, users can reset passwords via "Forgot your password?" on the login page (reset link valid for 1 hour).

:::warning
Without SMTP, password resets require manual admin intervention.
:::

## Push Notification 2FA

Two-factor authentication via push notifications using the [MieWeb Auth App](https://github.com/mieweb/mieweb_auth_app).

### Setup

1. Enter the **Push Notification URL** (your notification service endpoint)
2. Check **Enable Push Notification 2FA**
3. Save

### Flow

1. User enters username/password
2. Push notification sent to registered device
3. User approves/rejects on mobile
4. Access granted or denied

Users without a registered device see an error with a link to register.

### Notification Service API

```
POST {notification_url}/send-notification
{ "username": "user123" }
```

Responses:
- `{"success": true, "action": "approve|reject|timeout"}`
- `{"success": false, "message": "..."}`

### LDAP Integration

When enabled, `AUTH_BACKENDS` is set to `sql,notification` and `NOTIFICATION_URL` is propagated to the LDAP server environment variables automatically.

## Access Control

Requires membership in a group with admin privileges (typically `sysadmins`). See [Users & Groups](core-concepts/users-and-groups).
