# Create-a-Container

A web application for managing LXC container creation, configuration, and lifecycle on Proxmox VE infrastructure. Provides a user-friendly interface and REST API for container management with automated database tracking and nginx reverse proxy configuration generation.

## Data Model

```mermaid
erDiagram
    Node ||--o{ Container : "hosts"
    Container ||--o{ Service : "exposes"
    
    Node {
        int id PK
        string name UK "Proxmox node name"
        string apiUrl "Proxmox API URL"
        boolean tlsVerify "Verify TLS certificates"
        datetime createdAt
        datetime updatedAt
    }
    
    Container {
        int id PK
        string hostname UK "FQDN hostname"
        string username "Owner username"
        string osRelease "OS distribution"
        int nodeId FK "References Node"
        int containerId UK "Proxmox VMID"
        string macAddress UK "MAC address"
        string ipv4Address UK "IPv4 address"
        string aiContainer "Node type flag"
        datetime createdAt
        datetime updatedAt
    }
    
    Service {
        int id PK
        int containerId FK "References Container"
        enum type "tcp, udp, or http"
        int internalPort "Port inside container"
        int externalPort "External port (tcp/udp only)"
        boolean tls "TLS enabled (tcp only)"
        string externalHostname UK "Public hostname (http only)"
        datetime createdAt
        datetime updatedAt
    }
```

**Key Constraints:**
- `(Node.name)` - Unique
- `(Container.hostname)` - Unique
- `(Container.nodeId, Container.containerId)` - Unique (same VMID can exist on different nodes)
- `(Service.externalHostname)` - Unique when type='http'
- `(Service.type, Service.externalPort)` - Unique when type='tcp' or type='udp'

## Features

- **User Authentication** - Proxmox VE authentication integration
- **Container Management** - Create, list, and track LXC containers
- **Service Registry** - Track HTTP/TCP/UDP services running on containers
- **Dynamic Nginx Config** - Generate nginx reverse proxy configurations on-demand
- **Real-time Progress** - SSE (Server-Sent Events) for container creation progress
- **User Registration** - Self-service account request system with email notifications
- **Rate Limiting** - Protection against abuse (100 requests per 15 minutes)

## Prerequisites

### System Requirements
- **Node.js** 18.x or higher
- **MariaDB/MySQL** 5.7 or higher
- **Proxmox VE** cluster with API access
- **SMTP server** for email notifications (optional)

### Services
```bash
# Install Node.js (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install MariaDB
sudo apt-get install mariadb-server -y
sudo mysql_secure_installation
```

## Installation

### 1. Clone Repository
```bash
cd /opt
sudo git clone https://github.com/mieweb/opensource-server.git
cd opensource-server/create-a-container
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Database Setup

#### Create Database and User
```sql
CREATE DATABASE opensource_containers CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'container_manager'@'localhost' IDENTIFIED BY 'secure_password_here';
GRANT ALL PRIVILEGES ON opensource_containers.* TO 'container_manager'@'localhost';
FLUSH PRIVILEGES;
```

#### Run Migrations
```bash
npm run db:migrate
```

This creates the following tables:
- `Containers` - Container records (hostname, IP, MAC, OS, etc.)
- `Services` - Service mappings (ports, protocols, hostnames)

### 4. Configuration

Create a `.env` file in the `create-a-container` directory:

```bash
# Database Configuration
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=container_manager
MYSQL_PASSWORD=secure_password_here
MYSQL_DATABASE=opensource_containers

# Session Configuration
SESSION_SECRET=generate_random_secret_here

# Application
NODE_ENV=production
```

#### Generate Session Secret
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Start Application

#### Development Mode (with auto-reload)
```bash
npm run dev
```

#### Production Mode
```bash
node server.js
```

#### As a System Service
Create `/etc/systemd/system/create-a-container.service`:
```ini
[Unit]
Description=Create-a-Container Service
After=network.target mariadb.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/opensource-server/create-a-container
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable create-a-container
sudo systemctl start create-a-container
sudo systemctl status create-a-container
```

## API Routes

### Authentication Routes

#### `GET /login`
Display login page

#### `POST /login`
Authenticate user with Proxmox VE credentials
- **Body**: `{ username, password }`
- **Returns**: `{ success: true, redirect: "/" }`

#### `POST /logout`
End user session

### Container Management Routes

#### `GET /` 
Redirect to `/containers`

#### `GET /containers` (Auth Required)
List all containers for authenticated user
- **Returns**: HTML page with container list

#### `GET /containers/new` (Auth Required)
Display container creation form

#### `POST /containers`
Create or register a container
- **Query Parameter**: `init` (boolean) - If true, requires auth and spawns container creation
- **Body (init=true)**: `{ hostname, osRelease, httpPort, aiContainer }`
- **Body (init=false)**: Container registration data (for scripts)
- **Returns (init=true)**: Redirect to status page
- **Returns (init=false)**: `{ containerId, message }`

#### `GET /status/:jobId` (Auth Required)
View container creation progress page

#### `GET /api/stream/:jobId`
SSE stream for real-time container creation progress
- **Returns**: Server-Sent Events stream

### Configuration Routes

#### `GET /nginx.conf`
Generate nginx configuration for all registered services
- **Returns**: `text/plain` - Complete nginx configuration with all server blocks

### User Registration Routes

#### `GET /register`
Display account request form

#### `POST /register`
Submit account request (sends email to admins)
- **Body**: `{ name, email, username, reason }`
- **Returns**: Success message

### Utility Routes

#### `GET /send-test-email` (Dev Only)
Test email configuration (development/testing)

## Database Schema

### Containers Table
```sql
id              INT PRIMARY KEY AUTO_INCREMENT
hostname        VARCHAR(255) UNIQUE NOT NULL
username        VARCHAR(255) NOT NULL
osRelease       VARCHAR(255)
containerId     INT UNSIGNED UNIQUE
macAddress      VARCHAR(17) UNIQUE
ipv4Address     VARCHAR(45) UNIQUE
aiContainer     VARCHAR(50) DEFAULT 'N'
createdAt       DATETIME
updatedAt       DATETIME
```

### Services Table
```sql
id                  INT PRIMARY KEY AUTO_INCREMENT
containerId         INT FOREIGN KEY REFERENCES Containers(id)
type                ENUM('tcp', 'udp', 'http') NOT NULL
internalPort        INT NOT NULL
externalPort        INT
tls                 BOOLEAN DEFAULT FALSE
externalHostname    VARCHAR(255)
createdAt           DATETIME
updatedAt           DATETIME
```

## Configuration Files

### `config/config.js`
Sequelize database configuration (reads from `.env`)

### `models/`
- `container.js` - Container model definition
- `service.js` - Service model definition
- `index.js` - Sequelize initialization

### `data/services.json`
Service type definitions and port mappings

### `views/`
- `login.html` - Login form
- `form.html` - Container creation form
- `request-account.html` - Account request form
- `status.html` - Container creation progress viewer
- `containers.ejs` - Container list (EJS template)
- `nginx-conf.ejs` - Nginx config generator (EJS template)

### `public/`
- `style.css` - Application styles

### `migrations/`
Database migration files for schema management

## Environment Variables

### Required
- `MYSQL_HOST` - Database host (default: localhost)
- `MYSQL_PORT` - Database port (default: 3306)
- `MYSQL_USER` - Database username
- `MYSQL_PASSWORD` - Database password
- `MYSQL_DATABASE` - Database name
- `SESSION_SECRET` - Express session secret (cryptographically random string)

### Optional
- `NODE_ENV` - Environment (development/production, default: development)

## Security

### Authentication
- Proxmox VE integration via API
- Session-based authentication with secure cookies
- Per-route authentication middleware

### Rate Limiting
- 100 requests per 15-minute window per IP
- Protects against brute force and abuse

### Session Security
- Session secret required for cookie signing
- Secure cookie flag enabled
- Session data server-side only

### Input Validation
- URL encoding for all parameters
- Sequelize ORM prevents SQL injection
- Form data validation

## Troubleshooting

### Database Connection Issues
```bash
# Test database connection
mysql -h localhost -u container_manager -p opensource_containers

# Check if migrations ran
npm run db:migrate

# Verify tables exist
mysql -u container_manager -p -e "USE opensource_containers; SHOW TABLES;"
```

### Application Won't Start
```bash
# Check Node.js version
node --version  # Should be 18.x or higher

# Verify .env file exists and is readable
cat .env

# Check for syntax errors
node -c server.js

# Run with verbose logging
NODE_ENV=development node server.js
```

### Authentication Failing
```bash
# Verify Proxmox API is accessible
curl -k https://10.15.0.4:8006/api2/json/version

# Check if certificate validation is working
# Edit server.js if using self-signed certs
```

### Email Not Sending
```bash
# Test SMTP connection
telnet mail.example.com 25

# Test route (development only)
curl http://localhost:3000/send-test-email
```

### Port Already in Use
```bash
# Find process using port 3000
sudo lsof -i :3000

# Change port in .env or kill conflicting process
kill -9 <PID>
```

## Development

### Database Migrations
```bash
# Create new migration
npx sequelize-cli migration:generate --name description-here

# Run migrations
npm run db:migrate

# Undo last migration
npx sequelize-cli db:migrate:undo
```

### Code Structure
```
create-a-container/
├── server.js           # Main Express application
├── package.json        # Dependencies and scripts
├── .env               # Environment configuration (gitignored)
├── config/            # Sequelize configuration
├── models/            # Database models
├── migrations/        # Database migrations
├── views/             # HTML templates
├── public/            # Static assets
├── data/              # JSON data files
└── bin/               # Utility scripts
```

## Integration with Nginx Reverse Proxy

This application generates nginx configurations consumed by the `nginx-reverse-proxy` component:

1. Containers register their services in the database
2. The `/nginx.conf` endpoint generates complete nginx configs
3. The reverse proxy polls this endpoint via cron
4. Nginx automatically reloads with updated configurations

See `../nginx-reverse-proxy/README.md` for reverse proxy setup.

## License

See the main repository LICENSE file.

## Support

For issues, questions, or contributions, see the main opensource-server repository.
