# opensource-mieweb

## Getting Started
[Creating a LXC Container](https://www.youtube.com/watch?v=sVW3dkBqs4E)
[Deploying an Application Automatically](https://www.youtube.com/watch?v=acDW-a32Yr8)

Configuration storage for the [opensource.mieweb.com](https://opensource.mieweb.com) Proxmox project.

This repository contains configuration files and scripts for managing a Proxmox-based container hosting environment, including automated DNS, NGINX reverse proxy, and dynamic port mapping.

```
│   README.md
│   
├───intern-dnsmasq
│       dnsmasq.conf
│       
├───intern-nginx
│       nginx.conf
│       port_map.js
│       reverse_proxy.conf
│
└───intern-phxdc-pve1
        register-container.sh
        register_proxy_hook.sh
```

## Repository Structure

- [`intern-dnsmasq/dnsmasq.conf`](intern-dnsmasq/dnsmasq.conf):  
  Dnsmasq configuration for DHCP and DNS, including wildcard routing for the reverse proxy.

- [`intern-nginx/nginx.conf`](intern-nginx/nginx.conf):  
  Main NGINX configuration, loading the JavaScript module for dynamic backend resolution.

- [`intern-nginx/reverse_proxy.conf`](intern-nginx/reverse_proxy.conf):  
  NGINX reverse proxy config using dynamic JavaScript lookups for backend containers.

- [`intern-nginx/port_map.js`](intern-nginx/port_map.js):  
  JavaScript module for NGINX to map subdomains to backend container IPs and ports using a JSON file.

- [`intern-phxdc-pve1/register-container.sh`](intern-phxdc-pve1/register-container.sh):  
  Proxmox hook script to register new containers with the NGINX proxy and assign HTTP/SSH ports.

- [`intern-phxdc-pve1/register_proxy_hook.sh`](intern-phxdc-pve1/register_proxy_hook.sh):  
  Proxmox event hook to trigger container registration on startup.

## How It Works

- **DNS**: All `*.opensource.mieweb.com` requests are routed to the NGINX proxy via Dnsmasq.
- **Reverse Proxy**: NGINX uses a JavaScript module to dynamically resolve the backend IP and port for each subdomain, based on `/etc/nginx/port_map.json`.
- **Container Registration**: When a new container starts, Proxmox runs a hook script that:
  - Waits for the container to get a DHCP lease.
  - Assigns available HTTP and SSH ports.
  - Updates the NGINX port map and reloads NGINX.
  - Sets up port forwarding for SSH access.

## Usage

1. **Clone this repository** to your Proxmox host or configuration management system.
2. **Deploy the configuration files** to their respective locations on your infrastructure.
3. **Ensure dependencies**:
   - Proxmox VE with container support.
   - NGINX with the `ngx_http_js_module`.
   - Dnsmasq.
   - `jq` for JSON manipulation.
4. **Register new containers** using the provided hook scripts for automatic proxy and DNS integration.

---

*Current SME: Carter Myers and other contributors to opensource.mieweb.com *
