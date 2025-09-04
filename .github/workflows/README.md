# GitHub Workflows

This directory contains GitHub Actions workflows for automated testing and CI/CD.

## Container Creation JS Tests

**File:** `container-creation-tests.yml`

**Purpose:** Automatically runs the Jest test suite for the JavaScript authentication modules in the `container-creation/js/` directory.

**Triggers:**
- Push to `main` or `develop` branches (when JS files change)
- Pull requests to `main` or `develop` branches (when JS files change)

**Features:**
- Tests against Node.js versions 18 and 20
- Runs full test suite with coverage reporting
- Uploads coverage reports to Codecov
- Uses npm cache for faster builds
- Only runs when relevant files are modified

**Test Coverage:**
- `authenticateRepo.js` - Repository authentication module
- `authenticateUser.js` - User authentication module  
- `runner.js` - Command-line interface module

The workflow ensures all 40+ tests pass with 100% code coverage before merging changes.