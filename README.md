# Salt 2.0

A Progressive Web App built on Firebase with a strict hexagonal (ports-and-adapters) architecture.

- **Architecture contract:** [CLAUDE.md](./CLAUDE.md) (package layout + import rules, CI-enforced)
- **Architecture spec:** [docs/salt-architecture.md](./docs/salt-architecture.md)
- **E2E tests:** [docs/e2e.md](./docs/e2e.md)

## Getting started

```bash
nvm use         # Node 22
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm boundary:test
```
