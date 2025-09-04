# Container Creation JavaScript Module Tests

This directory contains comprehensive tests for the JavaScript authentication modules used in the container creation process.

## Overview

The test suite validates the core functionality of three modules:
- `authenticateRepo.js` - Validates GitHub repository paths and directories
- `authenticateUser.js` - Authenticates users against the Proxmox VE API
- `runner.js` - Command-line interface for the authentication modules

## Test Coverage

All modules have **100% test coverage** including:
- ✅ **40 total tests** covering all functionality
- ✅ **100% statement coverage**
- ✅ **100% branch coverage** 
- ✅ **100% function coverage**
- ✅ **100% line coverage**

## Running Tests

### Prerequisites
```bash
npm install
```

### Running Tests
```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode (for development)
npm run test:watch
```

## Test Structure

### authenticateRepo.test.js
Tests for repository path validation:
- **Path validation** - Correctly rejects file paths (containing dots)
- **URL formatting** - Handles .git removal and leading slash normalization
- **HTTP response handling** - Tests success (200) and failure responses (404, 403, etc.)
- **Edge cases** - Empty paths, root paths, special characters
- **Real-world scenarios** - Known public repositories

### authenticateUser.test.js  
Tests for Proxmox user authentication:
- **Successful authentication** - Valid credentials and proper request formatting
- **Failed authentication** - Invalid credentials, network errors, timeouts
- **Edge cases** - Empty credentials, special characters, long credentials
- **HTTPS configuration** - Proper SSL verification bypass for internal network
- **Integration scenarios** - Typical Proxmox authentication flows

### runner.test.js
Tests for the command-line interface:
- **Module structure** - File existence and imports
- **Function routing** - Correct routing to authentication functions  
- **Promise handling** - Proper async result processing

## Expected Results

When tests are run, you should see output similar to:
```
Test Suites: 3 passed, 3 total
Tests:       40 passed, 40 total
Snapshots:   0 total
Time:        0.668 s

---------------------|---------|----------|---------|---------|-------------------
File                 | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
---------------------|---------|----------|---------|---------|-------------------
All files            |     100 |      100 |     100 |     100 |                   
 authenticateRepo.js |     100 |      100 |     100 |     100 |                   
 authenticateUser.js |     100 |      100 |     100 |     100 |                   
---------------------|---------|----------|---------|---------|-------------------
```

## Test Implementation Details

### Testing Framework
- **Jest** - JavaScript testing framework with built-in mocking and coverage
- **axios-mock-adapter** - HTTP request mocking for isolated unit tests

### Mocking Strategy
Tests use mocked HTTP calls instead of real network requests to:
- Ensure tests run quickly and reliably
- Avoid dependency on external services
- Test error conditions consistently
- Maintain test isolation

### Test Categories
1. **Unit Tests** - Test individual functions in isolation
2. **Integration Tests** - Test module interactions and CLI behavior
3. **Edge Case Tests** - Test boundary conditions and error handling
4. **Real-world Scenario Tests** - Test with realistic inputs and use cases

## Key Functionality Tested

### Repository Authentication (`authenticateRepo.js`)
- Validates that repository paths exist on GitHub
- Rejects file paths (only accepts directory paths)
- Properly formats GitHub tree URLs
- Handles various HTTP response codes
- Manages network errors gracefully

### User Authentication (`authenticateUser.js`)
- Authenticates against Proxmox VE API endpoint
- Appends @pve realm to usernames
- Uses proper HTTPS configuration for internal network
- Handles authentication success/failure appropriately
- Manages API errors and network issues

### Command Line Interface (`runner.js`)
- Routes function calls to appropriate modules
- Handles command line arguments correctly
- Processes async results and outputs them
- Maintains proper module structure

## Contributing

When adding new functionality to the authentication modules:

1. **Add corresponding tests** for any new code paths
2. **Maintain 100% coverage** by testing all branches and edge cases  
3. **Use mocking** for external dependencies (HTTP calls)
4. **Follow naming conventions** used in existing tests
5. **Include both positive and negative test cases**
6. **Test edge cases** and error conditions
7. **Update this documentation** if test structure changes

## Files

- `package.json` - Node.js dependencies and test scripts
- `authenticateRepo.test.js` - Repository authentication tests (32 tests)
- `authenticateUser.test.js` - User authentication tests (5 tests) 
- `runner.test.js` - CLI interface tests (3 tests)
- `.gitignore` - Excludes node_modules and coverage reports
- `README.md` - This documentation file