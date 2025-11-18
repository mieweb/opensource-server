---
sidebar_position: 2
---

# Using a Supplied Runner (Path 1)

This guide covers **Path 1** of Proxmox Launchpad: using your own GitHub self-hosted runners or external runners to manage containers. This is the **recommended approach** for most users.

:::tip Why Path 1 is Recommended
- **No GitHub PAT required** - Enhanced security
- **Faster execution** - No runner provisioning overhead
- **Full control** - Use your preferred runner environment
- **Simpler setup** - Fewer configuration steps
:::

## Prerequisites

Before getting started, ensure you have:
- **Valid Proxmox account** on the MIE cluster
- **GitHub self-hosted runner** or external runner configured in your repository
- **Repository secrets** configured (see below)

### Repository Secrets Setup

Navigate to your repository settings and add these secrets:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `PROXMOX_USERNAME` | Your assigned Proxmox username | `john.doe` |
| `PROXMOX_PASSWORD` | Your assigned Proxmox password | `your-password` |

:::note Secret Management
Store these securely in your repository's **Settings > Secrets and variables > Actions**. Never commit credentials directly to your code.
:::

## Basic Workflow Setup

### 1. Required Workflow Triggers

All Proxmox Launchpad workflows must include these trigger events:

```yaml
on:
  push:     # Updates existing containers
  create:   # Creates containers for new branches
  delete:   # Removes containers when branches are deleted
```

### 2. Minimal Workflow Configuration

Create `.github/workflows/proxmox-launchpad.yml` in your repository:

```yaml
name: Proxmox Container Management

on:
  push:
  create:
  delete:

jobs:
  manage-container:
    runs-on: self-hosted  # Use your runner label here
    steps:
      - uses: maxklema/proxmox-launchpad@main
        with:
          proxmox_username: your-username
          proxmox_password: ${{ secrets.PROXMOX_PASSWORD }}
```

This creates basic containers without automatic deployment.

## Configuration Options

### Basic Container Properties

Configure your container's fundamental settings:

```yaml
- uses: maxklema/proxmox-launchpad@main
  with:
    proxmox_username: your-username
    proxmox_password: ${{ secrets.PROXMOX_PASSWORD }}

    # Optional: HTTP port (default: 3000)
    http_port: 8080

    # Optional: Linux distribution (default: debian)
    linux_distribution: debian  # Options: debian, rocky

    # Optional: SSH public key for passwordless access
    public_key: ${{ secrets.SSH_PUBLIC_KEY }}
```

#### Configuration Details

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `proxmox_username` | Yes | N/A | Your assigned Proxmox username |
| `proxmox_password` | Yes | N/A | Your assigned Proxmox password |
| `http_port` | No | `3000` | HTTP port (80-60000) for your application |
| `linux_distribution` | No | `debian` | Container OS: `debian` (Debian 12) or `rocky` (Rocky 9.5) |
| `public_key` | No | N/A | SSH public key for passwordless container access |

### SSH Access Setup

For enhanced security, add your SSH public key:

```yaml
public_key: ${{ secrets.SSH_PUBLIC_KEY }}
```

**Benefits:**
- Passwordless SSH access to your containers
- More secure than password authentication
- Easier automation and scripting

:::note Note
Entering a public key is highly recommended. To create a private/public key pair on your machine, reference [this guide](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent#generating-a-new-ssh-key).
:::

## Automatic Deployment Configuration

Enable automatic deployment to have your application deployed on every push:


:::important Important
If you want Proxmox Launchpad to automatically deploy your application, consider the options below and add them to your workflow file.
**If you do not want to deploy your application automatically, you do not need to include any of the options below and can simply disregard them.**
:::
### Single-Component Applications

For applications with a single service (React app, Flask server, etc.):

```yaml
- uses: maxklema/proxmox-launchpad@main
  with:
    proxmox_username: your-username
    proxmox_password: ${{ secrets.PROXMOX_PASSWORD }}

    # Deployment configuration
    project_root: ""  # Leave blank for repository root
    install_command: "npm install"
    start_command: "npm start"
    runtime_language: "nodejs"

    # Optional: Build command
    build_command: "npm run build"

    # Optional: Environment variables
    container_env_vars: '{"API_KEY": "your-api-key", "NODE_ENV": "production"}'

    # Optional: Services
    services: '["mongodb", "redis"]'
```

### Multi-Component Applications

For applications with multiple services (frontend + backend, microservices, etc.):

```yaml
- uses: maxklema/proxmox-launchpad@main
  with:
    proxmox_username: your-username
    proxmox_password: ${{ secrets.PROXMOX_PASSWORD }}

    # Multi-component configuration
    install_command: '{"/frontend": "npm install", "/backend": "pip install -r requirements.txt"}'
    start_command: '{"/frontend": "npm start", "/backend": "flask run --host=0.0.0.0"}'
    runtime_language: '{"/frontend": "nodejs", "/backend": "python"}'

    # Optional: Build commands per component
    build_command: '{"/frontend": "npm run build", "/backend": "python setup.py build"}'

    # Optional: Environment variables per component
    container_env_vars: '{"/frontend": {"REACT_APP_API_URL": "http://localhost:5000"}, "/backend": {"FLASK_ENV": "production"}}'

    # Optional: Root directory command (e.g., Docker Compose)
    root_start_command: "docker-compose up -d"
```

#### Multi-Component Structure

Each component path is relative to your project root:

```
your-repo/
├── frontend/          # Component path: "frontend/"
│   ├── package.json
│   └── src/
├── backend/           # Component path: "backend/"
│   ├── requirements.txt
│   └── app.py
└── docker-compose.yml # Root commands run here
```

### Automatic Deployment Properties

| Propety | Required? | Description | Single Component | Multi-Component |
| --------- | ----- |  ------------------------------------ | ---- | --- |
|  `multi_component` | Conditional | A `y` flag that specifies if your application is multi-component. This only needs to be set if your application is multi-component. | N/A | A string of `y`.
|  `container_env_vars` | No. | Key-Value Environment variable pairs. | Dictionary in the form of: `{ "api_key": "123", "password": "abc"}` | Dictionary in the form of: `'{"/frontend": { "api_key": "123"}, "/backend": { "password": "abc123" }}'`.
|  `install_command` | Yes* | Commands to install all project dependencies | String of the installation command, i.e. `npm install`. | Dictionary in the form of: `'{"/frontend": "npm install", "/backend": "pip install -r ../requirements.txt"}'`.
|  `build_command` | No | Commands to build project components | String of the build command, i.e. `npm build`. | Dictionary in the form of: `'{"/frontend": "npm build", "/backend": "python3 build.py"}'`.
|  `start_command` | Yes* | Commands to start project components. | String of the start command, i.e. `npm run`. | Dictionary in the form of: `'{"/frontend": "npm run", "/backend": "flask run"}'`.
|  `runtime_language` | Yes* | Runtime language of each project component, which can either be `nodejs` or `python`. | String of runtime environment, i.e. `nodejs` | Dictionary in the form of: `'{"/frontend": "nodejs", "/backend": "python"}'`.
|  `root_start_command` | No | Command to run at the project directory root for **multi-component applications**. | N/A | String of the command, i.e. `Docker-compose up ...`

> * (*) These options are only required if `root_start_command` is not provided, as that command may be a docker build and/or a docker compose command that builds the entire application.

### Services Configuration

Add pre-configured services to your container:

```yaml
# Available services
services: '["mongodb", "postgresql", "redis", "docker", "nginx", "apache"]'
```

#### Available Services

| Service | Description | Use Case |
|---------|-------------|----------|
| `mongodb` | MongoDB database | Document storage, NoSQL applications |
| `postgresql` | PostgreSQL database | Relational database, SQL applications |
| `redis` | Redis cache | Caching, session storage |
| `docker` | Docker runtime | Containerized applications |
| `nginx` | NGINX web server | Reverse proxy, static file serving |
| `apache` | Apache web server | Web hosting, PHP applications |
| `rabbitmq` | RabbitMQ message broker | Message queuing, microservices |
| `memcached` | Memcached caching | Distributed caching |
| `mariadb` | MariaDB database | MySQL-compatible database |
| `meteor` | Meteor framework | Full-stack JavaScript applications |

:::note Service Dependencies
Some services like `meteor` include other services (MongoDB). You don't need to install dependencies separately.
:::

### Custom Services

Install services not in the standard list:

```yaml
custom_services: |
  [
    ["sudo apt-get update", "sudo apt-get install -y nginx", "sudo systemctl enable nginx", "sudo systemctl start nginx"],
    ["curl -fsSL https://get.docker.com | sh", "sudo systemctl enable docker", "sudo systemctl start docker"]
  ]
```

Each array represents the installation commands for one custom service.

:::important Important
Make sure you enable and start your service using the systemctl service manager CLI.
:::

## Complete Workflow Examples

### Example 1: React Application with MongoDB

```yaml
name: React App with Database

on:
  push:
  create:
  delete:

jobs:
  manage-container:
    runs-on: self-hosted
    steps:
      - uses: maxklema/proxmox-launchpad@main
        with:
          proxmox_username: your-username
          proxmox_password: ${{ secrets.PROXMOX_PASSWORD }}
          public_key: ${{ secrets.SSH_PUBLIC_KEY }}

          # Container settings
          http_port: 3000
          linux_distribution: debian

          # Application deployment
          install_command: "npm install"
          build_command: "npm run build"
          start_command: "npm start"
          runtime_language: "nodejs"

          # Environment and services
          container_env_vars: '{"REACT_APP_API_URL": "http://0.0.0.0:5000", "NODE_ENV": "production"}'
          services: '["mongodb"]'
```

### Example 2: Full-Stack Application (Frontend + Backend)

```yaml
name: Full-Stack Deployment

on:
  push:
  create:
  delete:

jobs:
  manage-container:
    runs-on: self-hosted
    steps:
      - uses: maxklema/proxmox-launchpad@main
        with:
          proxmox_username: your-username
          proxmox_password: ${{ secrets.PROXMOX_PASSWORD }}
          public_key: ${{ secrets.SSH_PUBLIC_KEY }}

          # Multi-component configuration
          install_command: '{"/client": "npm install", "/server": "pip install -r requirements.txt"}'
          build_command: '{"/client": "npm run build"}'
          start_command: '{"/client": "npm start", "/server": "flask run --host=0.0.0.0 --port=5000"}'
          runtime_language: '{"/client": "nodejs", "/server": "python"}'

          # Environment variables per component
          container_env_vars: '{"/client": {"REACT_APP_API_URL": "http://0.0.0.0:5000"}, "/server": {"FLASK_ENV": "production", "DATABASE_URL": "mongodb://localhost:27017/myapp"}}'

          # Services for the application
          services: '["mongodb", "redis"]'
```

### Example 3: Microservices with Docker

```yaml
name: Microservices Deployment

on:
  push:
  create:
  delete:

jobs:
  manage-container:
    runs-on: self-hosted
    steps:
      - uses: maxklema/proxmox-launchpad@main
        with:
          proxmox_username: your-username
          proxmox_password: ${{ secrets.PROXMOX_PASSWORD }}

          # Use Docker Compose for orchestration
          root_start_command: "docker-compose up -d"

          # Individual service configuration
          install_command: '{"/api": "npm install", "/worker": "pip install -r requirements.txt"}'
          start_command: '{"/api": "npm start", "/worker": "python worker.py"}'
          runtime_language: '{"/api": "nodejs", "/worker": "python"}'

          # Docker and database services
          services: '["docker", "postgresql", "redis"]'
```

## Important Deployment Notes

### Application Binding

:::warning Critical for Multi-Component Apps
Ensure your backend services bind to `0.0.0.0` (all interfaces) instead of `127.0.0.1` (localhost only) for proper communication between components.
:::

**Examples:**
```python
# Flask - Correct
app.run(host='0.0.0.0', port=5000)

# Flask - Incorrect
app.run(host='127.0.0.1', port=5000)
```

```javascript
// Express - Correct
app.listen(5000, '0.0.0.0');

// Express - Incorrect
app.listen(5000, 'localhost');
```

### Special Framework Notes

#### Meteor Applications
```yaml
start_command: "meteor --allow-superuser --port 0.0.0.0:3000"
```

:::note Meteor Installation
Meteor is a large package and may take additional time to install and deploy.
:::

#### Vite.js Applications

If you are using vite.js as a frontend service, you need to add the domain name of your container in the allowHosts array in your `vite.config.js` file.

```yml
server: {
    host: '0.0.0.0',
    port: 32000,
    proxy: {
      '/api': 'http://localhost:5000',
    },
    allowedHosts: ['maxklema-polyglot-test-main.opensource.mieweb.org']
  },
```

### Environment Variables

Environment variables are automatically written to `.env` files in the appropriate component directories:

- **Single-component**: `.env` in project root
- **Multi-component**: `.env` in each component directory

## Container Access and Management

### Accessing Your Container

After successful deployment, you'll receive output like:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hostname Registration: my-app-main → 10.15.129.23
SSH Port               : 2344
HTTP Port              : 3000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Container ID        : 136
Internal IP         : 10.15.129.23
Domain Name         : https://my-app-main.opensource.mieweb.org
SSH Access          : ssh -p 2344 root@my-app-main.opensource.mieweb.org
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### SSH Access Methods

**With password (default):**
```bash
ssh -p 2344 root@my-app-main.opensource.mieweb.org
# Use your Proxmox account password
```

**With SSH key (if configured):**
```bash
ssh -p 2344 -i ~/.ssh/id_rsa root@my-app-main.opensource.mieweb.org
# Passwordless access
```

### Container Lifecycle

| Event | Action | Result |
|-------|--------|---------|
| **First push to branch** | Creates new container | ~3-7 minutes setup time |
| **Subsequent pushes** | Updates existing container | ~30 seconds - 2 minutes |
| **Branch deletion** | Removes container | Automatic cleanup (may take up to 5 minutes) |

:::note Background Processing
Even after the GitHub Action completes, background scripts may still be running. Wait 1-2 minutes for all processes to complete before accessing your application.
:::

## Troubleshooting

### Common Issues

**Container not accessible:**
- Wait 2-5 minutes for background scripts to complete
- Check that your start commands are correct
- Verify your application binds to `0.0.0.0` not `localhost`

**Dependencies fail to install:**
- Ensure dependency files (`package.json`, `requirements.txt`) are in the correct directories
- Check that files are committed to your repository
- Verify paths are relative to component directories

**Services not communicating:**
- Ensure backend services bind to `0.0.0.0`
- Check frontend API URLs point to correct backend ports
- Verify environment variables are set correctly

**GitHub Action fails:**
- Check repository secrets are set correctly
- Ensure runner has proper permissions
- Verify all required properties are provided

### Debug Container Issues

SSH into your container and check:

```bash
# Check running processes
ps aux | grep node
ps aux | grep python

# Check listening ports
ss -tlnp | grep LISTEN

# Check environment variables
cat /path/to/component/.env

# Check application logs (if using tmux)
tmux attach -t 0
```

---

**Next Steps**: Learn about [Path 2: Automatic Runner Provisioning](/docs/proxmox-launchpad/automatic-runner-provisioning) for automatically provisioning your runners.
