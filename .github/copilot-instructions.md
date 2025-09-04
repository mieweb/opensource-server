# GitHub Copilot Instructions for opensource-mieweb

**ALWAYS follow these instructions first. Only search for additional information or run bash commands when the information below is incomplete or found to be in error.**

This repository contains configuration and automation scripts for managing a Proxmox-based LXC container hosting environment with automated DNS, NGINX reverse proxy, LDAP authentication, and security monitoring via Wazuh.

## Repository Structure

### Core Infrastructure
- **`container creation/`** - LXC container lifecycle management scripts
- **`gateway/`** - Network routing, iptables management, and daily cleanup scripts  
- **`nginx reverse proxy/`** - NGINX configuration with JavaScript modules for dynamic backend resolution
- **`dnsmasq service/`** - DNS/DHCP services with wildcard routing
- **`LDAP/`** - Authentication infrastructure (contains git submodules)
- **`Wazuh/`** - Security monitoring with Node.js management scripts
- **`ci-cd automation/`** - Contains Proxmox-Launchpad GitHub Action submodule

### Git Submodules (CRITICAL - Must Initialize)
- **`LDAP/LDAPServer`** - Node.js LDAP gateway server
- **`LDAP/pown`** - LDAP client automation with Terraform/AWS testing
- **`ci-cd automation/Proxmox-Launchpad`** - GitHub Action for container deployment

## Working Effectively

### Bootstrap Repository (REQUIRED FIRST STEPS)
1. **Initialize submodules**: `git submodule update --init --recursive` 
   - Takes ~30 seconds. NEVER CANCEL.
   - Set timeout to 60+ seconds.

2. **Build Wazuh component**:
   ```bash
   cd Wazuh
   npm install
   ```
   - Takes ~1 second. Builds successfully.

3. **Build LDAPServer component**:
   ```bash
   cd "LDAP/LDAPServer/src"
   npm install
   ```
   - Takes ~12 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
   - Expect deprecation warnings - these are normal and build succeeds.

### Validation Commands (Run After Any Changes)

**CRITICAL**: Always run these validation steps before committing changes:

1. **Syntax check all shell scripts**:
   ```bash
   find . -name "*.sh" -exec bash -n {} \;
   ```
   - Takes <1 second. Must complete without errors.

2. **Syntax check all JavaScript files**:
   ```bash
   find . -name "*.js" -exec node -c {} \;
   ```
   - Takes <1 second. Must complete without errors.

3. **Verify Node.js applications can start** (they will fail to connect to external services, which is expected):
   ```bash
   # Test Wazuh runner (should run without errors)
   cd Wazuh && node runner.js getAgents 2>/dev/null && echo "Wazuh runner OK"
   
   # Test LDAPServer (will fail with config errors, which is expected)
   cd "LDAP/LDAPServer/src" && timeout 5 node index.js 2>/dev/null || echo "LDAPServer needs config (expected)"
   ```

## Manual Validation Scenarios

**ALWAYS test infrastructure changes with these scenarios:**

### Container Creation Scripts
Most container scripts require Proxmox infrastructure, but you can:
- **Syntax validate**: All scripts in `container creation/` pass `bash -n` checks
- **Check dependencies**: Scripts source from `/var/lib/vz/snippets/` (will be missing in sandbox)
- **Verify logic**: Review script flow in `container creation/create-container.sh` (220 lines)

### Network and Gateway Scripts  
- **Test syntax**: All scripts in `gateway/` are syntactically valid
- **Review cleanup logic**: `gateway/prune_iptables.sh` and `gateway/prune_temp_files.sh`
- **Check fingerprint extraction**: `gateway/extract-fingerprint.sh`

### LDAP Configuration
- **Environment setup**: Copy `.env.example` to `.env` in `LDAP/LDAPServer/src/` before testing
- **Client automation**: Review `LDAP/pown/pown.sh` for LDAP client setup logic
- **Test framework**: `LDAP/pown/tests/test.sh` requires AWS credentials (not available in sandbox)

## Technology Stack & Dependencies

### Node.js Applications
- **Required Node.js version**: >=18.0.0, npm >=9.0.0 (available in environment)
- **Wazuh dependencies**: axios, dotenv (lightweight, builds quickly)
- **LDAPServer dependencies**: ldapjs, mongodb, mysql2, winston (complex, longer build time)

### Shell Scripts  
- **Bash scripts**: All use `#!/bin/bash` with `set -e` for error handling
- **Dependencies**: Expect Proxmox `pct` commands, LDAP utilities, iptables
- **External services**: Scripts reference Wazuh server, LDAP servers, database connections

### Infrastructure Dependencies
- **Proxmox VE**: Required for container management commands
- **External services**: LDAP authentication, Wazuh manager, database servers
- **Network infrastructure**: DNS, NGINX reverse proxy, iptables rules

## Common Tasks & Expected Timings

### Build Operations
- **Full repository setup**: ~45 seconds (submodules + npm installs)
- **Wazuh build**: <1 second
- **LDAPServer build**: ~12 seconds
- **Syntax validation**: <1 second for all scripts

### Development Workflow
1. **Always initialize submodules first** if working from fresh clone
2. **Run syntax validation** after any script changes
3. **Test Node.js builds** after package.json modifications  
4. **Review configuration files** (.env.example, ossec.conf, etc.) for external service requirements
5. **Check script dependencies** - most require Proxmox/LDAP infrastructure not available in sandbox

## Troubleshooting

### Build Issues
- **LDAPServer deprecation warnings**: Normal, build still succeeds
- **Missing /var/lib/vz/snippets/**: Expected in sandbox - scripts source Proxmox-specific paths
- **LDAP connection errors**: Expected - requires actual LDAP server configuration
- **Wazuh API failures**: Expected - requires Wazuh manager with authentication

### Script Issues
- **Permission denied**: Scripts expect to run on Proxmox host with root/sudo access
- **Command not found (pct, pvesh)**: Proxmox utilities not available in sandbox
- **Network connectivity**: External services (Wazuh, LDAP) not accessible from sandbox

### Configuration Issues
- **Missing .env files**: Copy from .env.example templates when available
- **SSL/TLS errors**: Scripts expect certificate content in environment variables
- **Database connections**: MySQL/MongoDB connection strings required for LDAPServer

## DO NOT Attempt
- **Running container creation scripts**: Requires Proxmox VE host
- **LDAP server connections**: Requires configured LDAP infrastructure  
- **Wazuh agent registration**: Requires Wazuh manager with API access
- **Network configuration changes**: Requires iptables and DNS management permissions
- **AWS/Terraform tests**: `LDAP/pown/tests/` requires AWS credentials

## Key Files to Reference

### Main Scripts
- `container creation/create-container.sh` - Main container lifecycle script
- `gateway/prune_iptables.sh` - Network cleanup automation
- `Wazuh/runner.js` - Wazuh agent management interface

### Configuration Templates
- `LDAP/LDAPServer/src/.env.example` - LDAP server configuration
- `Wazuh/ossec.conf` - Wazuh agent configuration
- `nginx reverse proxy/` - Web server configuration files

### Package Management
- `Wazuh/package.json` - Security monitoring dependencies
- `LDAP/LDAPServer/src/package.json` - LDAP gateway dependencies

Always reference README.md files in individual directories for component-specific details.