---
sidebar_position: 2
---

# Single-Component Deployment

This guide walks you through deploying a single-component application automatically during container creation. A single-component application runs as one service with unified dependencies, build commands, and start commands.

:::note Prerequisites
- Valid Proxmox account on the MIE cluster
- Public GitHub repository with your application code
- Basic understanding of your application's requirements
:::

## Getting Started

Follow the [basic container creation steps](/docs/users/creating-containers/basic-containers/command-line) until you reach the automatic deployment prompt:

```
Do you want to deploy your project automatically? (y/n) →  
```

Answer `y` to begin the deployment configuration process.

## 1: Repository Information

### Project Repository
```
Paste the link to your project repository →  
```

**Requirements:**
- Must be a valid, accessible GitHub repository URL
- Repository must be public
- Examples: `https://github.com/username/my-app` or `https://github.com/username/my-app.git`

**Validation:** The script checks if the repository exists and is accessible.

### Project Branch
```
Enter the project branch to deploy from (leave blank for "main") →  
```

**Options:**
- Leave blank to use the default `main` branch
- Enter specific branch name (e.g., `develop`, `staging`)
- If your default branch is `master`, you must type `master`

**Validation:** The script verifies the branch exists in your repository.

### Project Root Directory
```
Enter the project root directory (relative to repository root directory, or leave blank for root directory) →  
```

**Options:**
- Leave blank to deploy from repository root (most common)
- Enter relative path if your application is in a subdirectory (e.g., `app/`, `src/backend/`)

**Validation:** The script confirms the directory exists in your repository.

## 2: Component Configuration

### Multi-Component Check
```
Does your app consist of multiple components that run independently, i.e. separate frontend and backend (y/n) →  
```

**For single-component applications, answer `n` or leave blank.**

## 3: Environment Variables (Optional)

```
Does your application require environment variables? (y/n) →  
```

If you answer `y`, you'll be prompted for key-value pairs:

```
Enter Environment Variable Key →  
Enter Environment Variable Value →  
Do you want to enter another Environment Variable? (y/n) →  
```

**Examples:**
- `API_KEY` → `your-api-key-value`
- `DATABASE_URL` → `mongodb://localhost:27017/myapp`
- `NODE_ENV` → `production`

**Notes:**
- Environment variables are stored in a `.env` file in your project root
- Both key and value are required (cannot be empty)
- Continue adding variables or press Enter when finished

## 4: Build Commands (Optional)

```
Enter the build command (leave blank if no build command) →  
```

**Examples:**
- `npm run build` (React, Angular, Vue applications)
- `python setup.py build` (Python applications)
- `make build` (Applications with Makefiles)

**Leave blank if:** Your application doesn't require a build step.

## 5: Install Commands (Required)

```
Enter the install command (e.g., 'npm install') →  
```

**Examples:**
- `npm install` (Node.js applications)
- `pip install -r requirements.txt` (Python applications)

:::important Important
If you are deploying a component that is made in Python, and you have a `requirements.txt` file, make sure the requirements.txt file is in your project's root directory, or enter the path to the `requirements.txt` relatve to your project's root directory.
:::

**This step is required** - your application must have an install command.

## 6: Start Commands (Required)

```
Enter the start command (e.g., 'npm start', 'python app.py') →  
```

**Examples:**
- `npm start` (Node.js applications)
- `python app.py` (Python Flask/Django applications)
- `node server.js` (Node.js servers)

**Additional flags:** Include any necessary flags like hostname, port, or environment settings.

:::important Important
Many applications, by default, run HTTP/HTTPS services on 127.0.0.1 (localhost). Make sure your service is running on 0.0.0.0 instead (all IPv4 addresses on the machine).
:::

:::note Using Meteor?
If your application is a meteor application, you must include the flag --allow-superuser to run your application.
:::

## 7: Runtime Environment (Required)

```
Enter the underlying runtime environment for your project (e.g., 'nodejs', 'python') →  
```

**Supported runtimes:**
- `nodejs` - For Node.js, React, Angular, Vue, Express applications
- `python` - For Python, Flask, Django, FastAPI applications

:::note Note
Only `nodejs` and `python` are currently supported.
:::

## 8: Services (Optional)

```
Does your application require special services (i.e. Docker, MongoDB, etc.) to run on the container? (y/n) →  
```

If you answer `y`:

```
Enter the name of a service to add to your container or type "C" to set up a custom service installation (Enter to exit) →  
```

### Available Services
Common services include:
- `meteor` - Meteor framework
- `apache` - Apache web server
- `rabbitmq` - Message broker
- `memcached` - Caching service
- `mariadb` - MariaDB database
- `mongodb` - MongoDB database
- `postgresql` - PostgreSQL database  
- `redis` - Redis cache
- `docker` - Docker container runtime
- `nginx` - NGINX web server

:::note Note
Some services, like meteor, come pre-packaged with other services, like MongoDB. Installing the pre-packaged services like these separately is not necessary.
:::

### Custom Services
Type `C` to install a service not in the master list:

```
Configuring Custom Service Installation. For each prompt, enter a command that is a part of the installation process for your service on Debian Bookworm. Do not forget to enable and start the service at the end. Once you have entered all of your commands, press enter to continue

Enter Command 1: 
Enter Command 2: 
...
```

**Example custom service installation (NGINX):**
```
sudo apt update -y
sudo apt install nginx -y
sudo systemctl enable nginx
sudo systemctl start nginx
```

:::important Important
Make sure you enable and start your service using the systemctl service manager CLI.
:::

## 9: Automatic Deployment

After providing all information, the system automatically:

1. **Clones your repository** from the specified branch
2. **Allocates resources** (IP address, ports) via DHCP
3. **Configures LDAP**: Connects your container to an LDAP server
4. **Configures Wazuh**: Enables security monitoring on your container
5. **Installs services** (MongoDB, PostgreSQL, etc.)
6. **Installs dependencies** using your install command
7. **Builds the application** (if build command provided)
8. **Starts the application** using your start command
9. **Configures networking** (DNS, reverse proxy)

This process typically takes 2-5 minutes depending on your application's complexity.

## Understanding the Output

Once deployment completes, you'll receive output similar to:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔔  COPY THESE PORTS DOWN — For External Access
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌  Note: Your container listens on SSH Port 22 internally,
    but EXTERNAL traffic must use the SSH port listed below:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Hostname Registration: my-app → 10.15.19.181
🔐  SSH Port               : 2376
🌐  HTTP Port              : 3000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦  Container ID        : 116
🌐  Internal IP         : 10.15.19.181
🔗  Domain Name         : https://my-app.opensource.mieweb.org
🛠️  SSH Access          : ssh -p 2376 myusername@my-app.opensource.mieweb.org
🔑  Container Password  : Your proxmox account password
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTE: Additional background scripts are being ran in detached terminal sessions.
Wait up to two minutes for all processes to complete.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Output Explanation

| Field | Description |
|-------|-------------|
| **Hostname Registration** | Your application name mapped to the internal container IP |
| **SSH Port** | External port for SSH access (internal port 22 is mapped to this) |
| **HTTP Port** | Port your application is listening on |
| **Container ID** | Unique identifier for your container in Proxmox |
| **Internal IP** | Private IP address assigned to your container |
| **Domain Name** | Public URL where your application is accessible |
| **SSH Access** | Complete SSH command to access your container |
| **Container Password** | Same as your Proxmox account password |

:::important Important Notes
- Your application is accessible at the provided domain name
- Wait 1-2 minutes for all background processes to complete
- Even-numbered containers are automatically migrated to PVE2 for load balancing
- Your container password is the same as your Proxmox account password
:::

## Troubleshooting

**Repository validation fails:**
- Ensure the repository URL is correct and publicly accessible
- Check that the branch name exists
- Verify the project root directory path

**Runtime environment error:**
- Only `nodejs` and `python` are supported
- Ensure you're typing the runtime exactly as shown

**Service installation fails:**
- Check that service names are spelled correctly
- For custom services, ensure all commands are valid for Debian Bookworm

**Application not accessible:**
- Wait 2-5 minutes for all background scripts to complete
- Check that your start command is correct
- Verify your application listens on the specified HTTP port
- Run `tmux attach -t 0` inside your container to see any errors with you start/build command(s)

---

**Next Steps:** Once your single-component application is deployed, you can SSH into your container, view logs, or explore [multi-component deployment](/docs/users/creating-containers/advanced-containers/multi-component) for more complex applications.