
# Contributing

## Getting Started

1. Review the [GitHub repository](https://github.com/mieweb/opensource-server) and open issues
2. Set up a local dev environment using the [Development Workflow](development-workflow.md) guide
3. Fork the repository and create a feature branch
4. Make changes, test thoroughly, submit a pull request

## Pull Requests

Before submitting: verify the stack runs (`docker compose up -d`), manually test affected flows, and update docs if needed.

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

There is currently no automated test suite. Manually verify your changes against a running stack (`docker compose up -d`) — container creation/deletion, DNS resolution, NGINX routing, and LDAP auth as relevant.

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
