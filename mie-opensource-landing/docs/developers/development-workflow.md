---
sidebar_position: 3
---

# Development Workflow

This guide covers setting up a local development environment and contributing to the cluster management software.

## Prerequisites

To contribute to the cluster management software:

1. **Node.js**: Version 18+ for the API server and LDAP gateway
2. **Database**: SQLite (included), PostgreSQL, or MySQL
3. **Proxmox Access**: A Proxmox VE 13+ instance for testing
4. **Git**: For version control and contributions

## Local Development Setup

### Option 1: Using Docker Compose (Recommended)

The simplest way to develop is using the included Docker Compose setup which provides a PostgreSQL database:

```bash
# Clone the repository
git clone https://github.com/mieweb/opensource-server
cd opensource-server/create-a-container

# Configure environment
cp example.env .env
# Edit .env with your Proxmox settings and database configuration:
#   DATABASE_DIALECT=postgres
#   POSTGRES_HOST=localhost
#   POSTGRES_PORT=5432
#   POSTGRES_USER=your_user
#   POSTGRES_PASSWORD=your_password
#   POSTGRES_DATABASE=your_db

# Start PostgreSQL
docker compose up -d

# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Start the development server
npm run dev
```

### Option 2: Manual Setup

For development without Docker:

```bash
# Clone the repository
git clone https://github.com/mieweb/opensource-server
cd opensource-server/create-a-container

# Install dependencies
npm install

# Configure environment
cp example.env .env
# Edit .env with your Proxmox and database settings
# For SQLite (default): no additional database setup required
# For PostgreSQL/MySQL: ensure database server is running

# Run database migrations
npm run db:migrate

# Start the development server
npm run dev
```

## Architecture Overview

**Frontend:**
- EJS-based server-rendered UI for user and admin interfaces
- Rendered by the Express API server

**Backend API:**
- Express.js REST API server
- Sequelize ORM for database abstraction
- Routes for user, admin, and container management

**LDAP Server:**
- Standalone Node.js process
- Reads from the shared database
- Handles LDAP bind and search operations

## Key Directories

```
create-a-container/
├── models/          # Sequelize database models
├── routers/         # Express API route handlers
├── middlewares/     # Authentication & authorization
├── migrations/      # Database schema migrations
├── views/           # Server-rendered templates
└── public/          # Static assets
```

## Development Best Practices

### Code Style

- Follow the existing code style and conventions
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused

### Database Changes

- Always create migrations for schema changes
- Test migrations with both up and down
- Use transactions for multi-step migrations
- Document breaking changes

### API Development

- Follow RESTful conventions
- Validate input data before processing
- Return appropriate HTTP status codes
- Document new endpoints

### Testing

Before submitting changes:

- Test container creation and deletion
- Verify DNS resolution and NGINX routing
- Ensure LDAP authentication works correctly
- Run the test suite: `npm test`
- Check for linting errors: `npm run lint`

## Debugging

### Local Docker Image Build

You can build and test the Docker image locally before deploying:

```bash
# Build the Docker image from the repository root
docker build -t opensource-server:dev .

# Run the container (requires systemd support)
docker run -d --privileged \
  --name opensource-test \
  -p 80:80 -p 443:443 -p 53:53/udp \
  opensource-server:dev

# View container logs
docker logs -f opensource-test

# Access a shell in the container
docker exec -it opensource-test bash

# Stop and remove the test container
docker stop opensource-test && docker rm opensource-test
```

**Note:** The Dockerfile copies your local repository code (including uncommitted changes), making it ideal for testing changes before pushing to GitHub.

### CI/CD Pipeline

The project uses GitHub Actions to automatically build and push Docker images:

- **Trigger**: On every push to any branch
- **Registry**: GitHub Container Registry (ghcr.io)
- **Tags**: 
  - Branch name (e.g., `sprint`, `main`)
  - `latest` tag for main branch only
- **Build optimization**: Uses GitHub Actions cache for faster builds

The workflow file is located at `.github/workflows/docker-build-push.yml`.

### API Server

```bash
# Run with debugging output
DEBUG=* npm run dev

# Or use Node inspector
node --inspect index.js
```

### Database Queries

Enable Sequelize query logging in your environment:

```
DB_LOGGING=true
```

### Common Issues

**Port Already in Use:**
- Check for existing processes: `lsof -i :3000`
- Kill the process or use a different port

**Database Connection Errors:**
- Verify database credentials in `.env`
- Ensure database service is running (for Docker: `docker compose ps`)
- Check network connectivity
- For PostgreSQL via Docker Compose: ensure ports are not in use

**Docker Compose Issues:**
- Check container status: `docker compose ps`
- View logs: `docker compose logs postgres`
- Restart services: `docker compose restart`
- Clean start: `docker compose down -v && docker compose up -d`

**Proxmox API Errors:**
- Verify API credentials are correct
- Check TLS certificate settings
- Ensure Proxmox node is reachable

## Next Steps

- Review the [Contributing Guide](contributing) for submission guidelines
- Check the [System Architecture](system-architecture) to understand component interactions
- Visit the [GitHub repository](https://github.com/mieweb/opensource-server) for open issues
