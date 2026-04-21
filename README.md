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
| `@salt/firebase-adapter` | Firebase implementations of domain ports                       |
| `@salt/ui-components`    | shadcn-svelte component library (the only UI primitive source) |
| `@salt/testing-utils`    | Shared test fixtures and helpers                               |
| `@salt/web-pwa`          | SvelteKit PWA                                                  |
| `@salt/cloud-functions`  | Firebase Cloud Functions                                       |

## Getting started

```bash
nvm use        # Node 22
pnpm install
pnpm typecheck
pnpm lint
pnpm boundary:test
```
