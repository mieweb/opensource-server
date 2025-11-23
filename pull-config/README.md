# pull-config

Unified configuration management system for pulling configuration files from remote sources. Supports multiple service instances on the same server using run-parts.

## Architecture

The system uses **executable instance scripts** in `/etc/pull-config.d/`. Each script sets environment variables and calls the main pull-config binary. The cron job uses `run-parts` to execute all instances.

## Structure

```
pull-config/
├── bin/
│   └── pull-config          # Main script (called by instance scripts)
├── etc/
│   ├── cron.d/
│   │   └── pull-config      # Single cron entry using run-parts
│   └── pull-config.d/       # Executable instance scripts
│       ├── nginx            # Nginx instance (executable)
│       └── dnsmasq          # Dnsmasq instance (executable)
├── install.sh               # Installation script
└── README.md                # This file
```

## Installation

Run the installation script as root:

```bash
sudo ./install.sh
```

This will:
- Copy all instance scripts from `etc/pull-config.d/` to `/etc/pull-config.d/` (with execute permissions)
- Copy the cron job to `/etc/cron.d/pull-config`
- Set executable permissions on the main script

## How It Works

1. **Cron runs**: `run-parts /etc/pull-config.d` every minute
2. **Instance scripts execute**: Each script in `/etc/pull-config.d/` runs alphabetically
3. **Environment is set**: Each script exports required variables
4. **Main script is called**: Each script calls `exec /opt/opensource-server/pull-config/bin/pull-config`
5. **Configuration is pulled**: Main script fetches, validates, and applies config

## Usage

Instances run automatically via cron. To test manually:

```bash
# Test nginx instance
sudo /etc/pull-config.d/nginx

# Test dnsmasq instance
sudo /etc/pull-config.d/dnsmasq

# Run all instances (same as cron does)
sudo run-parts /etc/pull-config.d
```

## Configuration

Each instance is an executable script in `/etc/pull-config.d/<instance-name>`.

### Required Variables (must be exported)
- `CONF_FILE` - Target configuration file path
- `CONF_URL` - URL to fetch configuration from

### Optional Variables
- `TEST_COMMAND` - Command to validate config before applying
- `RELOAD_COMMAND` - Custom command to reload the service
- `SERVICE_NAME` - Service name for systemctl fallback

### Example: Nginx Instance (`/etc/pull-config.d/nginx`)

```bash
#!/usr/bin/env bash

SITE_ID=1
export CONF_FILE=/etc/nginx/nginx.conf
export CONF_URL=http://localhost:3000/sites/${SITE_ID}/nginx.conf
export TEST_COMMAND="nginx -t"
export RELOAD_COMMAND="nginx -s reload"
export SERVICE_NAME="nginx"

exec /opt/opensource-server/pull-config/bin/pull-config
```

### Example: Dnsmasq Instance (`/etc/pull-config.d/dnsmasq`)

```bash
#!/usr/bin/env bash

SITE_ID=1
export CONF_FILE=/etc/dnsmasq.d/site-${SITE_ID}.conf
export CONF_URL=http://localhost:3000/sites/${SITE_ID}/dnsmasq.conf
export TEST_COMMAND="dnsmasq --test"
export SERVICE_NAME="dnsmasq"

exec /opt/opensource-server/pull-config/bin/pull-config
```

## Adding New Instances

1. Create a new executable script in `/etc/pull-config.d/`:
   ```bash
   sudo nano /etc/pull-config.d/myservice
   ```

2. Add the instance configuration:
   ```bash
   #!/usr/bin/env bash
   
   export CONF_FILE=/etc/myservice/config.conf
   export CONF_URL=http://localhost:3000/sites/1/myservice.conf
   export TEST_COMMAND="myservice --validate-config"
   export SERVICE_NAME="myservice"
   
   exec /opt/opensource-server/pull-config/bin/pull-config
   ```

3. Make it executable:
   ```bash
   sudo chmod +x /etc/pull-config.d/myservice
   ```

That's it! The cron job will automatically pick it up on the next run via `run-parts`.

## Features

- **run-parts integration** - Standard Linux pattern for managing multiple scripts
- **No cron editing needed** - Add instances by just creating executable scripts
- **Alphabetical execution** - Instances run in alphabetical order
- **ETag support** - Only downloads when configuration changes
- **Configuration validation** - Tests config before applying
- **Automatic rollback** - Restores previous config if validation fails
- **Flexible reload** - Custom commands or systemctl integration
- **Independent execution** - Each instance runs separately

## File Naming

run-parts only executes files that match its naming rules:
- Must be executable
- Name can contain: `a-zA-Z0-9_-`
- No dots in filename (use `nginx` not `nginx.sh`)


