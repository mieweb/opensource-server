---
sidebar_position: 7
---

# System Settings

The Settings page provides system-wide configuration options for the cluster management system. This page is only accessible to administrators.

![Settings Page](/img/screenshots/settings-page.png)

## Push Notification 2FA

The cluster supports two-factor authentication (2FA) using push notifications via the [MieWeb Auth App](https://github.com/mieweb/mieweb_auth_app).

### Configuration

To enable push notification 2FA:

1. Navigate to **Settings** in the admin sidebar
2. Enter the **Push Notification URL** - the endpoint of your notification service
3. Check **Enable Push Notification 2FA** to activate the feature
4. Click **Save Settings**

:::warning URL Required
When push notification 2FA is enabled, you must provide a valid notification service URL. The system will validate this requirement before saving.
:::

### How It Works

When push notification 2FA is enabled:

1. Users enter their username and password on the login page
2. After successful password validation, the system sends a push notification to the user's registered device
3. Users must approve the login attempt on their mobile device
4. Once approved, access is granted and the user is redirected to their dashboard

### User Registration

Users must register their devices with the notification service before they can authenticate:

- If a user attempts to log in without a registered device, they will see an error message
- The error message includes a link to register their device with the [MieWeb Auth App](https://github.com/mieweb/mieweb_auth_app)
- After registration, users can log in using push notification 2FA

### Notification Service

The push notification feature requires a separate notification service. MIE provides:

- **[MieWeb Auth App](https://github.com/mieweb/mieweb_auth_app)**: Mobile application for receiving and approving login notifications
- **Notification Service API**: Backend service that handles push notification delivery

The notification service must implement the following endpoint:

```
POST {notification_url}/send-notification
{
  "username": "user123"
}
```

Expected responses:
- `{"success": true, "action": "approve"}` - User approved the login
- `{"success": true, "action": "reject"}` - User rejected the login
- `{"success": true, "action": "timeout"}` - Notification timed out
- `{"success": false, "message": "..."}` - Error occurred (e.g., no device registered)

### LDAP Integration

When push notification 2FA is enabled, the system automatically updates the `ldap.conf` configuration for all sites:

- `AUTH_BACKENDS` is set to `sql,notification` (adds notification authentication)
- `NOTIFICATION_URL` is set to the configured notification service URL

These settings are applied when:
- Creating a new site
- Updating an existing site's configuration
- Deploying containers that use LDAP authentication

## Access Control

:::info Administrator Only
The Settings page requires administrator privileges. Non-admin users will receive a "Forbidden" error if they attempt to access this page.
:::

To grant administrator access to a user:
1. Navigate to **Users** in the admin sidebar
2. Find the user account
3. Add them to a group with admin privileges (typically the `admins` group)

See [User Administration](users-and-groups) for more details on managing users and groups.
