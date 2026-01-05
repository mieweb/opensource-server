---
sidebar_position: 3
---

# Multi-Component Deployment

This guide walks you through deploying a multi-component application automatically during container creation. A multi-component application consists of multiple independent services (e.g., frontend + backend) that each require their own installation commands, start commands, and runtime environments.

:::note Prerequisites
- Valid Proxmox account on the MIE cluster
- Public GitHub repository with your application code
- Application with separate components in different directories
- Basic understanding of each component's requirements
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
- Examples: `https://github.com/username/my-fullstack-app`

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
- Enter relative path if your application is in a subdirectory

**Validation:** The script confirms the directory exists in your repository.

## 2: Component Configuration

### Multi-Component Check
```
Does your app consist of multiple components that run independently, i.e. separate frontend and backend (y/n) →  
```

**For multi-component applications, answer `y`.**

## 3: Environment Variables (Optional)

```
Does your application require environment variables? (y/n) →  
```

If you answer `y`, you'll configure environment variables **per component**:

### Component Path Selection
```
Enter the path of your component to enter environment variables →  
```

**Examples:**
- `frontend/` for React/Vue/Angular frontend
- `backend/` for Express/Flask/Django backend
- `api/` for API services
- `client/` for client applications

**Important:** Paths are relative to your project root directory.

### Environment Variable Entry
For each component, you'll be prompted:
```
Enter Environment Variable Key →  
Enter Environment Variable Value →  
Do you want to enter another Environment Variable? (y/n) →  
```

**Examples:**
- Frontend: `REACT_APP_API_URL` → `http://localhost:5000/api`
- Backend: `DATABASE_URL` → `mongodb://localhost:27017/myapp`
- Backend: `SECRET_KEY` → `your-secret-key`

### Multiple Components
After finishing one component's environment variables:
```
Enter the path of your component to enter environment variables →  
```

**Process:**
- Enter next component path (e.g., `backend/`)
- Configure its environment variables
- Repeat for all components that need environment variables
- Press Enter (leave blank) when finished

**Notes:**
- Each component gets its own `.env` file in its directory
- Environment variables are isolated per component

## 4: Build Commands (Optional)

### Component Build Commands
```
Enter the path of your component to enter the build command →  
```

Then for each component:
```
Enter the build command (leave blank if no build command) →  
```

**Examples:**
- Frontend: `npm run build` (React, Angular, Vue)
- Backend: Usually no build command needed
- TypeScript projects: `npm run build` or `tsc`

**Process:**
- Enter component path (e.g., `frontend/`)
- Enter build command for that component
- Repeat for all components requiring build steps
- Press Enter (leave blank) when finished

## 5: Install Commands (Required)

### Component Install Commands
```
Enter the path of your component to enter the install command →  
```

Then for each component:
```
Enter the install command (e.g., 'npm install') →  
```

**Examples:**
- Frontend (Node.js): `npm install`
- Backend (Node.js): `npm install`
- Backend (Python): `pip install -r requirements.txt`
- Backend (Python with path): `pip install -r ../requirements.txt`

**Process:**
- Enter component path (e.g., `frontend/`)
- Enter install command for that component
- Repeat for all components
- Press Enter when finished

:::important Important
- Commands run from within each component directory
- If your `requirements.txt` is in the project root, use relative paths like `../requirements.txt`
- Ensure dependency files are accessible from component directories
:::


## 6: Start Commands (Required)

### Component Start Commands
```
Enter the path of your component to enter the start command →  
```

Then for each component:
```
Enter the start command (e.g., 'npm start', 'python app.py') →  
```

**Examples:**
- Frontend: `npm run dev` (Vite), `npm start` (React)
- Backend (Node.js): `npm start`, `node server.js`
- Backend (Flask): `FLASK_ENV=production flask run`
- Backend (Django): `python manage.py runserver 0.0.0.0:5000`

**Process:**
- Enter component path for each component
- Enter start command for that component
- Repeat for all components
- Press Enter when finished

:::important Important
Many applications, by default, run HTTP/HTTPS services on 127.0.0.1 (localhost). Make sure your service is running on 0.0.0.0 instead (all IPv4 addresses on the machine).
:::

:::note Using Meteor?
If your application is a meteor application, you must include the flag --allow-superuser to run your application.
:::

### Root Directory Commands (Optional)
```
Do you want to run a command from the root directory? (e.g., 'docker-compose up') (Enter to skip) →  
```

**Use cases:**
- Docker Compose: `docker-compose up`
- Docker Build: `docker build . && docker run -p 3000:3000 myapp`
- Makefile commands: `make start`
- Shell scripts: `./start.sh`

**Leave blank if:** You don't need root-level commands.

## 7: Runtime Environment (Required)

For each component you've configured, specify its runtime:

```
Enter the underlying runtime environment for "frontend/" (e.g., 'nodejs', 'python') →  
Enter the underlying runtime environment for "backend/" (e.g., 'nodejs', 'python') →  
```

**Supported runtimes:**
- `nodejs` - For Node.js, React, Angular, Vue, Express applications
- `python` - For Python, Flask, Django, FastAPI applications

**Examples:**
- React frontend → `nodejs`
- Flask backend → `python`
- Express backend → `nodejs`
- Vue frontend → `nodejs`

:::note Note
Only `nodejs` and `python` are currently supported.
:::

## 8: Services (Optional)

```
Does your application require special services (i.e. Docker, MongoDB, etc.) to run on the container? (y/n) →  
```

Services are shared across all components in your application.

If you answer `y`:
```
Enter the name of a service to add to your container or type "C" to set up a custom service installation (Enter to exit) →  
```

### Available Services
Common services for multi-component apps:
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
Type `C` to install a service not in the master list and follow the prompts for custom installation commands.

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
6. **For each component:**
   - Navigates to component directory
   - Installs dependencies using install command
   - Builds if build command provided
   - Starts using start command in background
7. **Runs root commands** (if specified)
8. **Configures networking** (DNS, reverse proxy)

This process typically takes 3-7 minutes depending on the number of components and their complexity.

## Understanding the Output

Once deployment completes, you'll receive output similar to:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔔  COPY THESE PORTS DOWN — For External Access
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌  Note: Your container listens on SSH Port 22 internally,
    but EXTERNAL traffic must use the SSH port listed below:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Hostname Registration: my-fullstack-app → 10.15.19.182
🔐  SSH Port               : 2377
🌐  HTTP Port              : 3000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦  Container ID        : 117
🌐  Internal IP         : 10.15.19.182
🔗  Domain Name         : https://my-fullstack-app.opensource.mieweb.org
🛠️  SSH Access          : ssh -p 2377 myusername@my-fullstack-app.opensource.mieweb.org
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
| **HTTP Port** | Primary port your application is listening on (usually frontend) |
| **Container ID** | Unique identifier for your container in Proxmox |
| **Internal IP** | Private IP address assigned to your container |
| **Domain Name** | Public URL where your application is accessible |
| **SSH Access** | Complete SSH command to access your container |
| **Container Password** | Same as your Proxmox account password |

:::important Important Notes
- Your application is accessible at the provided domain name
- All components run simultaneously in the background
- Wait 1-2 minutes for all background processes to complete
- Even-numbered containers are automatically migrated to PVE2 for load balancing
:::

## Verifying Multi-Component Deployment

After deployment, you can SSH into your container to verify all components are running:

```bash
ssh -p 2377 myusername@my-fullstack-app.opensource.mieweb.org
```

Check running processes:
```bash
ss -tlnp | grep LISTEN
```

You should see your components listening on their respective ports.

Check environment variables:
```bash
# Frontend environment variables
cat frontend/.env

# Backend environment variables  
cat backend/.env
```

## Troubleshooting

**Component path errors:**
- Ensure component paths are relative to your project root
- Check that directories exist in your repository

**Dependency installation fails:**
- For Python: Ensure `requirements.txt` path is correct relative to component directory
- For Node.js: Ensure `package.json` exists in component directory
- Check that dependency files are committed to your repository

**Services not communicating:**
- Ensure backend services bind to `0.0.0.0` not `localhost`
- Check that frontend API URLs point to correct backend port
- Verify environment variables are correctly set

**Runtime environment error:**
- Only `nodejs` and `python` are supported
- Ensure you're typing the runtime exactly as shown
- Each component can have different runtimes

**Application not Accessible:**
- Wait 2-5 minutes for all background scripts to complete
- Check that your start commands are correct
- Verify your application listens on the specified HTTP port
- Run `tmux attach -t 0` inside your container to see any errors with you start/build command(s)

---

**Next Steps:** Once your multi-component application is deployed, you can monitor each component, check logs via SSH, or explore using [Proxmox Launchpad](/docs/category/proxmox-launchpad) for automated CI/CD deployment.