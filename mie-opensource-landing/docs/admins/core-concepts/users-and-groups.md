---
sidebar_position: 3
---

# Users & Groups

## Groups

Groups organize users and define permissions. Two built-in groups:

- **ldapusers**: LDAP authentication to all containers
- **sysadmins**: Full admin access to Proxmox nodes and management software

### Creating a Group

Navigate to **Groups** → **Create New Group**. Required fields:
- **Name**: LDAP common name (CN)
- **GID**: Unique numeric Group ID
- **Administrator**: Toggle for full admin privileges

### Inviting Users

Admins can invite users via email: **Users** → **Invite User** → enter email → **Send Invitation**.

The recipient gets a secure link (expires in 24 hours). Registering via the link pre-fills and locks the email, and the account is **automatically activated**.

:::important
SMTP must be configured in [Settings](../settings) before sending invitations.
:::

## User Statuses

| Status | Description |
|--------|-------------|
| **Pending** | Awaiting admin approval |
| **Active** | Can authenticate to all cluster services |
| **Suspended** | Access revoked |

To approve: navigate to the user, change status to **Active**, optionally add to additional groups.

## LDAP Integration

Users in **ldapusers** can SSH into any container with their cluster credentials. GIDs, UIDs, and password changes are synchronized across all containers automatically.
