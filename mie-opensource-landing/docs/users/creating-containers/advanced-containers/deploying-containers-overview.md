---
sidebar_position: 1
---

# Deploying Containers Overview

The MIE Opensource Proxmox Cluster provides automated container deployment capabilities, allowing you to deploy applications directly from GitHub repositories without manual setup. This automation eliminates the need to SSH into containers, manually install dependencies, configure services, and start applications.

:::note Note
As of writing (8/14/25), automatic deploy only supports components that run on either a `nodejs` or `python` runtime environment.
:::

## Single vs Multi-Component Applications

### Single Component Applications

A **single component application** consists of one independent service or process that requires:
- One set of installation commands (e.g., `npm install`)
- One start command (e.g., `npm start`)
- One runtime environment (e.g., Node.js, Python)
- One package list or dependency file

**Examples:**
- A React frontend application
- A simple Express.js server
- A Flask API server
- A Meteor application

:::tip Tip
See the documentation for deploying single-component applications [here](/docs/users/creating-containers/advanced-containers/single-component).
:::

### Multi-Component Applications

A **multi-component application** consists of multiple independent services that each require:
- Their own installation commands
- Their own start commands
- Their own runtime environments
- Their own dependency files and environment variables

**Examples:**
- React frontend + Flask backend
- Vue.js frontend + Express.js API + MongoDB
- Angular frontend + Django backend + PostgreSQL
- Multiple microservices working together

:::tip Tip
See the documentation for deploying multi-component applications [here](/docs/users/creating-containers/advanced-containers/multi-component).
:::

### Key Differences

| Aspect | Single Component | Multi-Component |
|--------|------------------|-----------------|
| **Services** | One service/process | Multiple independent services |
| **Dependencies** | One package file | Multiple package files per component |
| **Runtime** | One runtime environment | Multiple runtime environments (although each runtime environment could be the same) |
| **Start Commands** | One start command | Multiple start commands |
| **Environment Variables** | One .env file | Multiple .env files per component |

## Benefits of Automated Deployment

### Eliminates Manual Setup
- **No SSH Required**: Deploy without manually connecting to containers
- **Automatic Dependencies**: Dependencies are installed automatically from package files
- **Service Configuration**: Required services (MongoDB, PostgreSQL, etc.) are installed and configured automatically
- **Environment Setup**: Environment variables are configured in the correct locations

### Reduces Deployment Time
- **Instant Deployment**: Applications are ready immediately after container creation
- **Consistent Environment**: Same deployment process every time, reducing errors
- **Parallel Processing**: Multiple components are set up simultaneously

### Simplifies Development Workflow
- **GitHub Integration**: Deploy directly from your repository with Proxmox Launchpad

:::note Note
It is recommended to deploy your application on a test container via the command line first before working with [Proxmox Launchpad](/docs/category/proxmox-launchpad).
:::


## When to Use Each Method

**Choose Single Component Deployment when:**
- Your application runs as one process
- All dependencies are in one package file
- You have one entry point/start command

**Choose Multi-Component Deployment when:**
- Your application has separate frontend and backend
- Different parts use different runtime enviornments
- Components have different dependency requirements
- You need different environment variables for different services

---

Ready to deploy? Choose your deployment method:
- [Single Component Deployment Guide](/docs/users/creating-containers/advanced-containers/single-component)
- [Multi-Component Deployment Guide](/docs/users/creating-containers/advanced-containers/multi-component)

