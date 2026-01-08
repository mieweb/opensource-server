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

```bash
# Clone the repository
git clone https://github.com/mieweb/opensource-server
cd opensource-server/create-a-container

# Install dependencies
npm install

# Configure environment
cp example.env .env
# Edit .env with your Proxmox and database settings

# Run database migrations
npx sequelize-cli db:migrate

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
- Ensure database service is running
- Check network connectivity

**Proxmox API Errors:**
- Verify API credentials are correct
- Check TLS certificate settings
- Ensure Proxmox node is reachable

## Next Steps

- Review the [Contributing Guide](contributing) for submission guidelines
- Check the [System Architecture](system-architecture) to understand component interactions
- Visit the [GitHub repository](https://github.com/mieweb/opensource-server) for open issues
