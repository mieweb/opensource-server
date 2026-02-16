---
sidebar_position: 4
---

# Contributing

## Getting Started

1. Review the [GitHub repository](https://github.com/mieweb/opensource-server) and open issues
2. Set up a local dev environment using the [Development Workflow](development-workflow) guide
3. Fork the repository and create a feature branch
4. Make changes, test thoroughly, submit a pull request

## Pull Requests

Before submitting: `npm test`, `npm run lint`, update docs if needed.

Include in your PR: summary of changes, related issues, how you tested, screenshots for UI changes, and any breaking changes.

## Commit Messages

Follow [conventional commits](https://www.conventionalcommits.org/):

```
type(scope): subject
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

```
feat(containers): add support for custom CPU limits
fix(auth): resolve LDAP authentication timeout issue
```

## Testing

- Write unit tests for new functions
- Test API endpoints end-to-end
- Manually verify container creation/deletion, DNS resolution, NGINX routing, and LDAP auth

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
