---
sidebar_position: 3
---

# Users & Groups

User accounts and groups form the foundation of access control in the cluster management system. Groups determine permissions and provide LDAP authentication for container access.

## Groups

Groups organize users and define their permissions within the cluster.

### Default Groups

The system includes two built-in groups:

- **ldapusers**: Members can authenticate via LDAP to all containers in the cluster
- **sysadmins**: Members receive full administrative access to both Proxmox nodes and the cluster management software

### Group Properties

When creating a new group, you must configure:

- **Name**: The LDAP common name (CN) used for authentication
- **GID**: A unique numeric Group ID used by the LDAP server
- **Administrator**: Toggle to grant members full Proxmox and software administration privileges

:::important GID Uniqueness
Each group must have a unique numeric GID. The LDAP server uses this identifier, so conflicts will cause authentication issues.
:::

### Creating a Group

1. Navigate to **Groups** in the administration interface
2. Click **Create New Group**
3. Enter a descriptive name (will be used as LDAP CN)
4. Assign a unique numeric GID
5. Enable **Administrator** if members should have full cluster access
6. Save the group

## Users

User accounts allow individuals to authenticate and access cluster resources.

### User Registration

Users typically register themselves through the web interface by providing:

- Username
- First name
- Last name
- Email address
- Password

Newly registered users are automatically:
- Set to **Pending** status
- Added to the **ldapusers** group

:::tip Manual User Creation
Administrators can also create user accounts manually through the admin interface, skipping the registration process.
:::

### Inviting Users

Administrators can invite new users via email, which streamlines onboarding by automatically activating accounts upon registration.

**To invite a user:**

1. Navigate to **Users** in the administration interface
2. Click **Invite User** (next to the "New User" button)
3. Enter the email address of the person you want to invite
4. Click **Send Invitation**

**How it works:**

- The system sends an email with a secure registration link
- The link expires after **24 hours**
- When the recipient registers using the link, their email is pre-filled and locked
- Their account is **automatically activated** (no admin approval needed)
- Each invitation link can only be used once

:::important SMTP Configuration Required
You must configure SMTP settings before sending invitations. If SMTP is not configured, you'll receive an error message prompting you to set it up in **Settings**.
:::

:::note Duplicate Emails
You cannot invite an email address that is already registered to an existing user.
:::

### User Statuses

Users can have one of three statuses:

- **Pending**: Newly registered, awaiting administrator approval
- **Active**: Approved and able to authenticate to all cluster services
- **Suspended**: Access revoked, cannot authenticate anywhere

:::important Authentication Requirement
Only users with **Active** status can log in to the management interface, Proxmox, or any containers.
:::

### Approving Users

To approve a pending user:

1. Navigate to **Users** in the administration interface
2. Find the pending user
3. Change their status to **Active**
4. Optionally add them to additional groups beyond **ldapusers**
5. Save the changes

### Managing Group Membership

To modify a user's group memberships:

1. Navigate to the user's detail page
2. In the **Groups** section, add or remove group assignments
3. Save changes

Group membership changes take effect immediately for new authentication attempts.

## LDAP Integration

The built-in LDAP server uses group and user information to provide authentication services to all containers in the cluster.

### How It Works

- Users in the **ldapusers** group can SSH into any container using their cluster credentials
- Group IDs (GIDs) and user IDs (UIDs) are synchronized across all containers
- Password changes in the management interface propagate to LDAP immediately

### Best Practices

- Keep the **ldapusers** group for general container access
- Create additional groups for team-based or project-based access control
- Use the **Administrator** flag sparingly - only for trusted cluster administrators
- Regularly review and approve pending user registrations
- Suspend rather than delete users who leave the organization (preserves audit trails)

## Security Considerations

### Password Management

- Enforce strong password policies during registration
- Passwords are hashed and never stored in plaintext
- Users can reset their own passwords through the web interface

### Administrator Access

Users in administrator groups have extensive privileges:
- Full Proxmox API access on all nodes
- Ability to create, modify, and delete any resource
- Access to all user data and configurations

Only grant administrator status to trusted individuals.

### Audit Trail

All user actions are logged, including:
- Login attempts (successful and failed)
- Status changes (pending → active, active → suspended)
- Group membership modifications
- Resource creation and deletion

Review logs regularly to detect unauthorized access attempts.

## Next Steps

Once you've configured users and groups, proceed to:
- [**Sites**](sites): Set up your network infrastructure
- [**Nodes**](nodes): Connect your Proxmox servers
