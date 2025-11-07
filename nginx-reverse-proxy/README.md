# Nginx Reverse Proxy

This directory contains the automation for dynamically configuring nginx reverse proxy based on container services registered in the create-a-container database.

## Overview

The reverse proxy configuration is automatically synchronized from the create-a-container API endpoint, which generates nginx server blocks for all registered container services with HTTP endpoints.

## Components

### `pull-config.sh`
Bash script that:
1. Checks for an existing ETag and sends it with the request (If-None-Match header)
2. Skips all operations if the server returns 304 Not Modified (no changes)
3. Falls back to internal cluster URL if the primary URL returns a 502 error
4. Backs up the current nginx configuration (if it exists)
5. Downloads the latest configuration from the API endpoint
6. Tests the new configuration with `nginx -t`
7. Rolls back to the backup if validation fails (if backup exists)
8. Saves the ETag for future requests
9. Reloads nginx if validation succeeds

This approach ensures:
- **Efficient bandwidth usage**: Only downloads when configuration has changed
- **High availability**: Automatically falls back to internal URL on gateway errors
- **Bootstrap-friendly**: Works correctly on first run when no config exists yet

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
# No need to pre-create the config file - the script handles first run when no existing configuration exists
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
- `ETAG_FILE`: `/etc/nginx/conf.d/reverse-proxy.etag` - Stores ETag for caching
- `CONF_URL`: `https://create-a-container.opensource.mieweb.org/nginx.conf` - Primary API endpoint
- `FALLBACK_URL`: `http://create-a-container.cluster.mieweb.org:3000/nginx.conf` - Fallback endpoint (used on 502 errors)

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

**Note**: Thanks to ETag-based caching, running the script every minute has minimal overhead. After the first successful run, the script only downloads and reloads nginx when the configuration actually changes. Most runs will exit early with a 304 Not Modified response.

### Optimizations

#### ETag-Based Caching
The script uses HTTP ETags to avoid unnecessary downloads. On each run:
- If an ETag exists from a previous run, it's sent with the request
- If the server returns 304 Not Modified, the script exits immediately
- This reduces bandwidth usage and prevents unnecessary nginx reloads

#### High Availability Fallback
If the primary URL (via reverse proxy) returns a 502 Bad Gateway error:
- The script automatically falls back to the internal cluster URL
- This handles the bootstrapping problem where the reverse proxy isn't configured yet
- The internal URL bypasses the reverse proxy and connects directly to the service

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

### Force Download (Bypass ETag Cache)
```bash
# Remove the ETag file to force a fresh download
sudo rm -f /etc/nginx/conf.d/reverse-proxy.etag
sudo /opt/opensource-server/nginx-reverse-proxy/pull-config.sh
```

### Disable Automatic Updates
```bash
# Temporarily disable cron job
sudo chmod 000 /etc/cron.d/nginx-pull-config

# Or remove it completely
sudo rm /etc/cron.d/nginx-pull-config
```

## Testing

The repository includes comprehensive test scripts to validate the pull-config.sh behavior:

### Run All Tests
```bash
cd /opt/opensource-server/nginx-reverse-proxy
./test-pull-config.sh
```

This tests:
- First run without existing configuration
- ETag caching (304 Not Modified handling)
- Configuration validation and rollback on failure

### Test 502 Fallback
```bash
cd /opt/opensource-server/nginx-reverse-proxy
./test-502-fallback.sh
```

This validates the fallback mechanism when the primary URL returns a 502 error.
