# Salt 2.0

A Progressive Web App built on Firebase with a strict hexagonal (ports-and-adapters) architecture.

See [CLAUDE.md](./CLAUDE.md) for the architecture contract enforced on all contributors (human and AI).

## Stack

- **Runtime:** Node 22 LTS
- **Package manager:** pnpm 10 (workspaces)
- **UI:** SvelteKit + shadcn-svelte
- **Backend:** Firebase (Firestore, Storage, Auth, Functions, Hosting)
- **Auth:** Magic link + Google

## Packages

| Package                  | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `@salt/shared-types`     | DTOs and error codes shared across all layers                  |
| `@salt/domain`           | Pure business logic — entities, ports, commands, queries       |
| `@salt/local-store`      | IndexedDB implementation of the LocalStore port                |
| `@salt/firebase-sync`    | Firebase Sync/Auth implementation of sync, realtime, auth ports|
| `@salt/ui-components`    | shadcn-svelte component library (the only UI primitive source) |
| `@salt/testing-utils`    | Shared test fixtures and helpers                               |
| `@salt/web-pwa`          | SvelteKit PWA                                                  |
| `@salt/cloud-functions`  | Firebase Cloud Functions (reserved for gen-AI workloads)       |

## Getting started

```bash
nvm use        # Node 22
pnpm install
pnpm typecheck
pnpm lint
pnpm boundary:test
```

## E2E tests

See [docs/e2e.md](docs/e2e.md) for running Playwright specs locally and CI behavior.
