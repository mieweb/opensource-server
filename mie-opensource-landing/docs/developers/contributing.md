---
sidebar_position: 4
---

# Contributing

We welcome contributions to the MIE Opensource Proxmox Cluster project! This guide will help you get started.

## Areas for Contribution

- **Frontend Development**: Improve the web UI, add new features
- **API Development**: Extend REST endpoints, optimize queries
- **Database Optimization**: Improve schema design, add indexes
- **DNS/NGINX Integration**: Enhance service exposure capabilities
- **LDAP Gateway**: Improve authentication mechanisms
- **Documentation**: Expand guides, add examples

## Getting Started

1. Review the [GitHub repository](https://github.com/mieweb/opensource-server)
2. Check open issues for contribution opportunities
3. Set up a local development environment using the [Development Workflow](development-workflow) guide
4. Fork the repository and create a feature branch
5. Make your changes and test thoroughly
6. Submit a pull request with a clear description

## Pull Request Guidelines

### Before Submitting

- Ensure all tests pass: `npm test`
- Check for linting errors: `npm run lint`
- Test your changes in a local environment
- Update documentation if needed
- Add tests for new features

### PR Description

Include in your pull request:

- **Summary**: Brief description of what changed and why
- **Related Issues**: Link to any related GitHub issues
- **Testing**: How you tested the changes
- **Screenshots**: If UI changes are involved
- **Breaking Changes**: Note any breaking changes

### Code Review Process

1. Submit your pull request
2. Automated tests will run
3. Maintainers will review your code
4. Address any feedback or requested changes
5. Once approved, your PR will be merged

## Coding Standards

### General Guidelines

- Follow existing code style and conventions
- Write clear, descriptive commit messages
- Keep commits focused on a single change
- Add comments for complex logic

### Commit Messages

Follow the conventional commits format:

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Test additions or modifications
- `chore`: Maintenance tasks

**Examples:**
```
feat(containers): add support for custom CPU limits

fix(auth): resolve LDAP authentication timeout issue

docs(admin): add troubleshooting section for node setup
```

## Testing Requirements

### Unit Tests

- Write tests for new functions and modules
- Maintain or improve code coverage
- Use descriptive test names

### Integration Tests

- Test API endpoints end-to-end
- Verify database operations
- Test container creation workflows

### Manual Testing

Before submitting:
- Test container creation and deletion
- Verify DNS resolution works correctly
- Check NGINX routing for services
- Ensure LDAP authentication functions
- Test with different database backends (if applicable)

## Documentation

### Code Documentation

- Add JSDoc comments for functions and classes
- Document function parameters and return values
- Explain non-obvious code behavior

### User Documentation

If your changes affect users:
- Update relevant documentation pages
- Add examples and screenshots
- Update the changelog

## Community Guidelines

### Communication

- Be respectful and professional
- Ask questions if you're unsure
- Provide constructive feedback
- Help others when you can

### Issue Reporting

When reporting issues:
- Use a clear, descriptive title
- Provide steps to reproduce
- Include error messages and logs
- Specify your environment (OS, Node version, etc.)

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

## Getting Help

- Check existing documentation and issues first
- Ask questions in GitHub issues or discussions
- Reach out to maintainers for guidance

## Resources

- [Development Workflow](development-workflow): Setup and development guide
- [System Architecture](system-architecture): Understand the system design
- [GitHub Repository](https://github.com/mieweb/opensource-server): View code and issues
- [Administrator Documentation](/docs/admins/): Learn about cluster management
- [User Documentation](/docs/users/creating-containers/web-gui): Understand user workflows

---

Thank you for contributing to the MIE Opensource Proxmox Cluster project!
