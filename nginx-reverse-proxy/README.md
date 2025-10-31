# Nginx Reverse Proxy

This directory contains the automation for dynamically configuring nginx reverse proxy based on container services registered in the create-a-container database.

## Overview

The reverse proxy configuration is automatically synchronized from the create-a-container API endpoint, which generates nginx server blocks for all registered container services with HTTP endpoints.

## Components

### `pull-config.sh`
Bash script that:
1. Backs up the current nginx configuration
2. Downloads the latest configuration from the API endpoint
3. Tests the new configuration with `nginx -t`
4. Rolls back to the backup if validation fails
5. Reloads nginx if validation succeeds

### `pull-config.cron`
Cron job definition that runs `pull-config.sh` every minute to keep the nginx configuration synchronized with the database.

### `port_map.js`
NJS (nginx JavaScript) module that performs dynamic subdomain-to-container routing by querying the create-a-container API endpoints.

### `reverse_proxy.conf`
Static nginx configuration that uses the `port_map.js` module for dynamic routing decisions.

## Prerequisites

### System Requirements
- **Nginx** installed and running (version 1.18+ recommended)
- **curl** for downloading configurations
- **Root/sudo access** for nginx configuration management

### Nginx Installation
```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install nginx -y

# Start and enable nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Verify installation
nginx -v
```

## Deployment

### 1. Clone Repository
```bash
cd /opt
sudo git clone https://github.com/mieweb/opensource-server.git
```

### 2. Install Cron Job
```bash
# Copy cron file to system cron directory
sudo cp /opt/opensource-server/nginx-reverse-proxy/pull-config.cron /etc/cron.d/nginx-pull-config

# Set proper permissions
sudo chmod 644 /etc/cron.d/nginx-pull-config
```

### 3. Make Script Executable
```bash
sudo chmod +x /opt/opensource-server/nginx-reverse-proxy/pull-config.sh
```

### 4. Initial Configuration Pull
```bash
# Run script manually to get initial configuration
sudo touch /etc/nginx/conf.d/reverse-proxy.conf
sudo /opt/opensource-server/nginx-reverse-proxy/pull-config.sh
```

### 5. Verify Setup
```bash
# Check if configuration file was created
ls -la /etc/nginx/conf.d/reverse-proxy.conf

# Test nginx configuration
sudo nginx -t

# Check cron logs
sudo tail -f /var/log/syslog | grep pull-config
```

## Configuration

### Environment Variables
The scripts use these default paths (can be modified in the scripts):

- `CONF_FILE`: `/etc/nginx/conf.d/reverse-proxy.conf` - Target nginx config file
- `CONF_URL`: `https://create-a-container.opensource.mieweb.org/nginx.conf` - API endpoint

### Cron Schedule
By default, the configuration is pulled every minute:
```
* * * * * root /opt/opensource-server/nginx-reverse-proxy/pull-config.sh
```

To change the schedule, edit `/etc/cron.d/nginx-pull-config` with standard cron syntax:
```
# Examples:
# Every 5 minutes: */5 * * * *
# Every hour: 0 * * * *
# Every day at midnight: 0 0 * * *
```

## Troubleshooting

### Configuration Pull Failures
```bash
# Check if API is accessible
curl -I https://create-a-container.opensource.mieweb.org/nginx.conf

# Manually run script with verbose output
sudo bash -x /opt/opensource-server/nginx-reverse-proxy/pull-config.sh
```

### Nginx Test Failures
```bash
# Check nginx error log
sudo tail -50 /var/log/nginx/error.log

# Test configuration manually
sudo nginx -t

# Check if backup was restored
ls -la /etc/nginx/conf.d/reverse-proxy.conf*
```

### Cron Not Running
```bash
# Check cron service status
sudo systemctl status cron

# Verify cron job exists
sudo cat /etc/cron.d/nginx-pull-config

# Check syslog for cron execution
sudo grep CRON /var/log/syslog | tail -20
```

### Permission Issues
```bash
# Ensure script is executable
sudo chmod +x /opt/opensource-server/nginx-reverse-proxy/pull-config.sh

# Ensure cron file has correct permissions
sudo chmod 644 /etc/cron.d/nginx-pull-config

# Ensure nginx can reload
sudo nginx -s reload
```

## Security Considerations

- The script runs as **root** (required for nginx management)
- Configuration is downloaded over **HTTPS** with certificate verification (`curl -fsSL`)
- Failed configurations are **automatically rolled back** to prevent service disruption
- Nginx configuration is **validated** before being applied

## Monitoring

Monitor the automated configuration updates:

```bash
# Watch nginx reload activity
sudo tail -f /var/log/nginx/error.log

# Monitor cron execution
sudo tail -f /var/log/syslog | grep pull-config

# Check configuration update timestamps
ls -lt /etc/nginx/conf.d/reverse-proxy.conf
```

## Manual Operations

### Force Configuration Update
```bash
sudo /opt/opensource-server/nginx-reverse-proxy/pull-config.sh
```

### Disable Automatic Updates
```bash
# Temporarily disable cron job
sudo chmod 000 /etc/cron.d/nginx-pull-config

# Or remove it completely
sudo rm /etc/cron.d/nginx-pull-config
```
