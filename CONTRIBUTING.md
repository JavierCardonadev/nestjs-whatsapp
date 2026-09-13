# Contributing

Thanks for helping! Issues and PRs are welcome in English, Spanish or Portuguese.

## Setup

```bash
git clone https://github.com/JavierCardonadev/nestjs-whatsapp.git
cd nestjs-whatsapp
npm install
npm test
```

Node.js ≥ 20.19 is required. Tests never call Meta: HTTP is mocked and webhooks are signed locally.

## Before opening a PR

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

- Keep the package free of runtime dependencies and `nestjs-whatsapp/core` free of NestJS imports.
- Base payload shapes and limits on Meta's official documentation and link the page in the PR.
- Webhook fixtures must use fake numbers, ids and names — never real conversations.
- Update `CHANGELOG.md` under **Unreleased** and both READMEs when the public API changes.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(messages): …`, `fix(webhooks): …`).

## Releases

Maintainers tag `vX.Y.Z`; the release workflow publishes to npm with provenance.
