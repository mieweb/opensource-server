
# LDAP Authentication

The base container images authenticate users against an external LDAP directory using [SSSD](https://sssd.io/docs/). Rather than shipping its own directory, the platform connects containers to **your existing LDAP infrastructure** (Active Directory, OpenLDAP, FreeIPA, 389 Directory Server, etc.). This guide covers pointing containers at your servers via environment variables and, optionally, configuring Proxmox to authenticate against the same directory.

## How It Works

Every base image runs **systemd as PID 1**. At boot, before SSSD starts, a oneshot unit renders the SSSD configuration from a template:

```
/etc/sssd/sssd.conf.template  --(envsubst, reads /etc/environment)-->  /etc/sssd/sssd.conf
```

The container's environment variables (written to `/etc/environment`) are substituted into the template, so the running SSSD config is built from the `SSSD_*` variables described below. Because the file is regenerated on every start, updating the variables and recreating the container is all that's needed to re-point authentication at a different directory.

The rendered `[domain/default]` section looks like this:

```ini
[sssd]
domains = default

[domain/default]
id_provider = ldap
auth_provider = ldap
ldap_uri = ${SSSD_LDAP_URI}
ldap_tls_reqcert = ${SSSD_LDAP_TLS_REQCERT}

ldap_schema = ${SSSD_LDAP_SCHEMA}
ldap_search_base = ${SSSD_LDAP_SEARCH_BASE}
ldap_user_search_base = ${SSSD_LDAP_USER_SEARCH_BASE}
ldap_group_search_base = ${SSSD_LDAP_GROUP_SEARCH_BASE}

# Map the LDAP cn attribute to the NSS gecos field so tools like getent,
# finger, and the git-identity profile script can read the user's full name.
ldap_user_gecos = cn

ldap_default_bind_dn = ${SSSD_LDAP_DEFAULT_BIND_DN}
ldap_default_authtok_type = ${SSSD_DEFAULT_AUTHTOK_TYPE}
ldap_default_authtok = ${SSSD_DEFAULT_AUTHTOK}

# Long enough for a push notification to be responded to
ldap_opt_timeout = 60
```

!!! note
    Any `SSSD_*` variable left blank is substituted as an empty value, and SSSD falls back to its built-in default (for example, auto-detecting the search base from the directory's RootDSE). Only set the variables your directory actually requires.

## Configuring the Connection

The recommended way to link every container to your directory is to set the `SSSD_*` variables as **default container environment variables** in [**System Settings**](settings.md). These defaults are applied to every container created on the cluster, so authentication is configured once and inherited automatically.

In the admin UI: **Settings** → **Default Container Environment Variables**. The following keys are seeded for you — fill in the values for your environment:

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SSSD_LDAP_URI` | `ldaps://ldap1:636, ldaps://ldap2:636` | Yes | Comma-separated list of LDAP server URIs. List two or more for automatic failover (e.g. `ldaps://dc1.example.com:636, ldaps://dc2.example.com:636`). |
| `SSSD_LDAP_TLS_REQCERT` | `allow` | Yes | TLS certificate validation policy: `never`, `allow`, `try`, or `demand`. Use `demand` to require a valid, trusted server certificate. |
| `SSSD_LDAP_SCHEMA` | *(blank)* | No | LDAP schema in use (e.g. `rfc2307`, `rfc2307bis`, `ad`). Leave blank to use the SSSD default. Set `ad` for Active Directory. |
| `SSSD_LDAP_SEARCH_BASE` | *(blank)* | No | Base DN for all searches (e.g. `dc=example,dc=com`). Leave blank to let SSSD auto-detect it from the RootDSE. |
| `SSSD_LDAP_USER_SEARCH_BASE` | *(blank)* | No | Base DN for user searches. Overrides `SSSD_LDAP_SEARCH_BASE` for users (e.g. `ou=people,dc=example,dc=com`). |
| `SSSD_LDAP_GROUP_SEARCH_BASE` | *(blank)* | No | Base DN for group searches (e.g. `ou=groups,dc=example,dc=com`). |
| `SSSD_LDAP_DEFAULT_BIND_DN` | *(blank)* | No | DN used to bind for lookups. Leave blank for anonymous bind; set it if your directory disallows anonymous searches (e.g. `cn=svc-sssd,ou=services,dc=example,dc=com`). |
| `SSSD_DEFAULT_AUTHTOK_TYPE` | *(blank)* | No | Type of the bind credential, typically `password`. Required when `SSSD_LDAP_DEFAULT_BIND_DN` is set. |
| `SSSD_DEFAULT_AUTHTOK` | *(blank)* | No | The bind credential (password) for the bind DN. Required when `SSSD_LDAP_DEFAULT_BIND_DN` is set. |

!!! tip
    `SSSD_LDAP_DEFAULT_BIND_DN`, `SSSD_DEFAULT_AUTHTOK_TYPE`, and `SSSD_DEFAULT_AUTHTOK` work as a set. Provide all three when your directory requires an authenticated bind to read users and groups; leave all three blank to bind anonymously. The service account only needs read access to the user and group subtrees — user passwords are verified by a separate bind as the authenticating user.

!!! warning
    `SSSD_DEFAULT_AUTHTOK` is a secret. The rendered `/etc/sssd/sssd.conf` is written with restrictive permissions (mode `0600`), but the value is also visible in the container's environment. Prefer a dedicated, least-privilege service account and rotate it like any other credential.

### Per-container overrides

Because these are ordinary container environment variables, an individual container can override any `SSSD_*` value at creation time (in the **Environment Variables** section of the container form, or via the API). This is useful for connecting a specific container to a different directory or test environment without changing the cluster-wide defaults.

### Requirements for your directory

- **LDAPS reachable from the cluster.** Containers connect over the URIs in `SSSD_LDAP_URI`; those hosts must be resolvable and reachable from the container network. If you use short names like `ldap1`, ensure they resolve via the site's DNS (DNSMasq); otherwise use fully-qualified domain names or IPs.
- **POSIX attributes on users.** SSSD expects `uid`, `uidNumber`, `gidNumber`, `homeDirectory`, and `cn`. Active Directory installations typically need the POSIX/RFC 2307 attributes populated (or schema `ad`).
- **Home directories** are created automatically on first login by PAM (`pam_mkhomedir`), so the directory itself only needs to supply the `homeDirectory` path.

## Verifying

SSH into any container and confirm the directory is reachable and users resolve:

```bash
# Show the rendered config (secrets included — handle with care)
sudo cat /etc/sssd/sssd.conf

# SSSD should be active
systemctl status sssd

# Look up a user that exists in your directory
getent passwd <username>
id <username>

# Clear the cache and force a fresh lookup if results look stale
sudo sss_cache -E
```

If `getent passwd <username>` returns the user, authentication and home-directory creation will work on first login.

## Proxmox LDAP Realm (Optional)

To let container ACLs reference directory users as `username@ldap`, configure Proxmox to authenticate against the **same** directory the containers use.

### DNS Configuration

If your `SSSD_LDAP_URI` uses names that only the cluster DNS resolves, point Proxmox at the same DNS server (the DNSMasq instance managed by the management software) so it can resolve them too. If you use public FQDNs this step is unnecessary.

In the Proxmox web UI: **Node** → **System** → **DNS** → set the DNS server to the DNSMasq IP address.

### Add the LDAP Realm

In the Proxmox web UI: **Datacenter** → **Permissions** → **Realms** → **Add** → **LDAP Server**.

| Setting | Value |
|---------|-------|
| Realm | `ldap` |
| Base Domain Name | Your directory's base DN (e.g. `dc=example,dc=com`) |
| User Attribute Name | `uid` (use `sAMAccountName` for Active Directory) |
| Default | ✅ (checked) |
| Server | Your primary LDAP host |
| Fallback Server | Your secondary LDAP host (optional) |
| Port | `636` |
| Mode | LDAPS |
| Verify Certificate | Match your `SSSD_LDAP_TLS_REQCERT` policy |
| Require TFA | none |

Under **Sync Options**:

| Setting | Value |
|---------|-------|
| Email Attribute | `mail` |
| Scope | Users and Groups |

All other settings remain at defaults.

### Sync Users

After adding the realm, sync it to import users and groups:

**Datacenter** → **Permissions** → **Realms** → select `ldap` → **Sync**.

The management software also triggers a sync automatically when creating containers (via `syncLdapRealm('ldap')`) so new users are available for ACL assignment.
