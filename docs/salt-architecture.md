# Salt 2.0 — Architecture Contract v0.3

## 1. Purpose

Salt 2.0 is a modular, enforceable architecture for a **local‑first PWA** with a Firebase backend used only for sync, realtime, and identity.
The goal is to maintain strict separation between:

- UI (apps/web-pwa)
- Domain logic (packages/domain)
- Local persistence adapter (packages/adapters/local-store)
- Cloud sync / realtime / auth adapter (packages/adapters/firebase-sync)
- Cloud Functions (apps/cloud-functions) — reserved for server‑side gen‑AI workloads

The architecture must remain framework‑agnostic, testable, and resilient to change, while supporting:

- Local‑first data access (IndexedDB is the on‑device source of truth)
- Occasional sync for recipes and canon (eventual consistency, conflict‑aware)
- Realtime collaboration for shopping lists (live, field‑level merge, no conflict prompts)
- Single‑family workspace (all members see all data; admin actions gated per user)

The two consistency models above are **deliberately different** and must be expressed as separate ports in the domain.

---

## 2. Mono‑repo structure (logical modules)

```
/apps
  web-pwa                         # PWA front-end (UI only)
  cloud-functions                 # Reserved for gen-AI; minimal until needed

/packages
  domain                          # Pure business logic, entities, validation, ports
  shared-types                    # Cross-cutting types/interfaces only
  ui-components                   # Shared UI primitives
  testing-utils                   # Shared test helpers
  adapters/
    local-store                   # IndexedDB implementation of local persistence ports
    firebase-sync                 # Firebase Storage + Firestore + Auth implementation
                                  # of sync, realtime, and auth ports
```

The two adapters are **siblings**, not layered. `firebase-sync` does not depend on `local-store`; both are wired together by the UI/composition layer.

---

## 3. Dependency graph (allowed imports)

### Allowed

- web-pwa → domain, shared-types, ui-components, local-store, firebase-sync
- cloud-functions → domain, shared-types, firebase-sync
- local-store → domain, shared-types
- firebase-sync → domain, shared-types
- domain → shared-types
- shared-types → (no dependencies)

### Forbidden

- UI → Cloud Functions
- UI → Firebase SDK directly
- UI → IndexedDB directly
- Domain → Firebase SDK / IndexedDB / Node / browser APIs
- Domain → UI
- Cloud Functions → UI
- local-store ↔ firebase-sync (adapters must not import each other)
- Any module → apps/web-pwa or apps/cloud-functions

These rules must be enforced via ESLint, tsconfig project references, and commit gateway checks.

---

## 4. Domain layer requirements

The domain layer is pure TypeScript:

- No Firebase imports
- No browser APIs (including IndexedDB)
- No Node APIs
- No side effects
- No I/O
- No global state

The domain exposes:

- Entities and value objects for:
  - Recipes (single-document model)
  - Canon items (name, synonyms, aisle, optional embedding)
  - Shopping lists (items, checked state, canon links)
  - Workspace (single‑family membership + per‑user roles)
- Commands (write operations)
- Queries (read operations)
- Validation rules
- **Conflict resolution policy** for recipes/canon (merge functions, field precedence, "keep mine / keep theirs / merge" semantics). The domain *defines* the policy; adapters only *execute* it.
- Ports (interfaces) for:
  - `LocalStore` — on‑device persistence (recipes, canon, shopping lists, sync metadata)
  - `SyncTransport` — occasional pull/push of recipes and canon
  - `RealtimeChannel` — live shopping‑list updates
  - `AuthProvider` — identity and workspace membership

The domain is the single source of truth for business logic, data shapes, and conflict semantics.

---

## 5. Workspace and access model

Salt 2.0 is built for a **single shared family workspace**:

- All authenticated members see all recipes, canon, and shopping lists.
- There is no per‑recipe ACL; there are no private collections.
- **Admin functions** (e.g. inviting members, managing canon at scale, destructive bulk operations) are gated by a per‑user `role` field on the workspace membership record.
- Role checks are domain logic, not adapter logic. Adapters surface the role; domain decides what's allowed.
- Security rules in the cloud backend mirror the domain rule: any workspace member can read/write workspace data; admin‑only mutations check role.

This model is intentionally narrow. Multi‑workspace, sharing, or per‑document permissions are explicitly **out of scope** until a real requirement appears.

---

## 6. Adapter requirements

### 6.1 local-store adapter

- Implements `LocalStore` using IndexedDB (or equivalent browser storage).
- Owns all on‑device persistence: recipes, canon, shopping lists, sync metadata (manifest cursor, pending writes queue).
- Must not import Firebase or any network code.
- Must not leak IndexedDB types across the boundary.
- Returns domain entities (or `Failure` / `Conflict`) only.

### 6.2 firebase-sync adapter

- Implements `SyncTransport`, `RealtimeChannel`, and `AuthProvider` using:
  - Firebase Storage and/or Firestore for blob/manifest sync
  - Firestore realtime listeners for shopping lists
  - Firebase Auth for identity
- Must not import IndexedDB or any local‑storage code.
- Must not contain UI logic.
- Must not contain domain logic — including conflict resolution. When a revision mismatch is detected, the adapter returns `Conflict<T>` and lets the domain/UI decide.
- Must not leak Firebase types across the boundary.

### 6.3 Common rules

- Both adapters convert their backend's responses into domain entities.
- Both adapters use `shared-types` for DTOs.
- Neither adapter imports the other; they are composed at the application layer.
- The two adapters together are the **only** modules permitted to import Firebase SDKs or browser storage APIs.

---

## 7. Adapter Error Contract

Adapters must never leak Firebase, IndexedDB, browser, or network‑layer errors across the boundary.
All failures must be normalised into **domain‑level error types** defined in shared‑types.

### 7.1 Error Shape

All adapter functions return either:

- `Success<T>`
- `Failure<DomainError>`
- `Conflict<T>` (for revision mismatches during sync)

Adapters must not throw for expected operational failures.

### 7.2 DomainError Categories

DomainError is a closed set of error categories:

- `AuthError`
  - unauthenticated, forbidden, expired session

- `NotFound`
  - recipe, canon item, shopping list, workspace

- `NetworkError`
  - offline, unreachable, transient network failure

- `StorageError`
  - local storage unavailable, quota exceeded, corruption detected

- `SyncError`
  - failed to push/pull, invalid revision, manifest mismatch

- `ConflictError`
  - concurrent write detected (recipes/canon only)

- `ValidationError`
  - invalid input according to domain rules

No Firebase/IndexedDB/browser error codes may cross the boundary.

### 7.3 Pending / Loading States

Adapters must expose **explicit pending states** for long‑running operations:

- `pending: true` for:
  - initial sync
  - blob upload/download
  - manifest refresh
  - shopping list subscription initialisation

UI must treat pending as a first‑class state, not infer it from undefined/null.

### 7.4 Conflict Semantics

For recipe/canon writes:

- If the adapter detects a revision mismatch:
  - return `Conflict<T>` with:
    - `local` (the user's attempted write)
    - `remote` (the latest version from cloud)
- UI decides which path to take, invoking the domain's conflict policy:
  - keep local
  - keep remote
  - merge (domain command)
- Adapter never auto‑resolves conflicts.

Shopping lists never return conflicts. They use realtime field‑level merge driven by the `RealtimeChannel` port; concurrent edits converge automatically.

### 7.5 Error Propagation Rules

- Adapters **never throw** for operational errors.
- Adapters **may throw** only for programmer errors (violated preconditions).
- UI must handle all `Failure` / `Conflict` states explicitly.
- Domain must not depend on adapter error shapes — only on `DomainError`.

### 7.6 Logging

- Adapters may log internal errors for diagnostics.
- Logs must not leak Firebase/IndexedDB types or raw error objects.
- Logs must not cross the adapter boundary.

### 7.7 Retry Behaviour

- `NetworkError` and `SyncError` may be retried automatically by the adapter.
- Retries must be bounded and backoff‑based.
- UI must be informed of:
  - retrying
  - exhausted retries
  - final failure

### 7.8 Offline Behaviour

- If offline:
  - reads come from local-store
  - writes to recipes/canon queue locally (in local-store)
  - shopping list updates are local only until connection restored
- firebase-sync must surface `NetworkError` when cloud sync is attempted offline.

---

## 8. Cloud Functions requirements

Cloud Functions exist in the architecture to support **server‑side gen‑AI workloads** (e.g. recipe parsing, embedding generation, model‑gated mutations). They are intentionally minimal until a gen‑AI feature requires them.

When implemented, Cloud Functions:

- Import domain + firebase-sync (never local-store; CFs have no browser storage)
- Never import UI
- Never contain business logic
- Only orchestrate:
  - Input validation
  - Calling domain commands/queries
  - Calling gen‑AI providers
  - Returning results
- Must be stateless
- Must be testable without Firebase emulators (via domain mocks)

Until a gen‑AI requirement lands, the `cloud-functions` app may remain a stub. Its contract is fixed; its surface is deferred.

---

## 9. PWA (UI) requirements

The PWA:

- Imports domain, local-store, firebase-sync, ui-components, shared-types
- Never imports Firebase SDK or IndexedDB directly
- Never contains business logic (including conflict resolution policy)
- Uses domain commands/queries as its API
- Wires `LocalStore`, `SyncTransport`, `RealtimeChannel`, and `AuthProvider` ports together at composition time
- Must support offline‑first behaviour (service worker + local-store)
- Must distinguish, in its UX, between:
  - **recipes/canon** — eventual consistency, may surface conflict prompts
  - **shopping lists** — realtime, no conflict prompts, optimistic updates expected to converge

UI is responsible for:

- Rendering
- Local view state
- User interactions
- Calling domain commands
- Displaying results, including pending / failure / conflict states

---

## 10. Shared types requirements

shared-types contains:

- DTOs
- API request/response shapes
- Cross-module enums
- DomainError categories and result types (`Success` / `Failure` / `Conflict`)
- Nothing with logic
- Nothing that depends on Firebase, IndexedDB, or browser APIs

This module must remain extremely small and stable.

---

## 11. Enforcement rules

### ESLint

- Enforce allowed import graph (boundaries plugin)
- Forbid Firebase imports outside firebase-sync
- Forbid IndexedDB / browser storage imports outside local-store
- Forbid local-store ↔ firebase-sync imports
- Forbid domain importing anything except shared-types
- Forbid UI importing Cloud Functions
- Forbid circular dependencies
- Enforce strict TypeScript rules

### tsconfig

- Use project references to enforce module boundaries
- Each module has its own tsconfig
- Root tsconfig defines the dependency graph

### Commit gateway

Every commit must:

- Pass linting
- Pass type checks
- Pass dependency graph checks
- Pass unit tests
- Pass formatting
- Reject any Firebase import outside firebase-sync
- Reject any IndexedDB import outside local-store
- Reject any UI → backend leakage
- Reject any domain impurity (Node/browser/Firebase imports)

---

## 12. Testing strategy

### Domain

- 100% unit testable without Firebase or IndexedDB
- Pure logic tests, including conflict resolution policy

### local-store

- Unit tests with fake IndexedDB
- Integration tests against a real browser storage environment

### firebase-sync

- Unit tests with mocks
- Integration tests against the Firebase emulator

### Cloud Functions

- Unit tests with mocked adapter
- Integration tests with emulator (once implemented)

### UI

- Component tests
- Integration tests (with both adapters wired to fakes)
- E2E tests (Playwright)

---

## 13. Deployment units

- web-pwa → deployed as PWA
- cloud-functions → deployed to Firebase Functions (when activated for gen‑AI)
- local-store → bundled into UI only
- firebase-sync → bundled into UI and (when activated) Functions
- domain → bundled into UI and Functions
- shared-types → type-only package

---

## 14. Versioning & stability

- Domain layer is the most stable
- Shared types must be versioned carefully
- Adapter ports change only when the domain port changes
- UI and Cloud Functions may change frequently
- Breaking changes must be explicit in commit messages (Conventional Commits)

---

## 15. Non-negotiables

- No Firebase SDK in UI or local-store
- No IndexedDB in UI or firebase-sync
- No business logic outside domain (including conflict resolution)
- No cross-module imports outside the allowed graph
- No global state
- No "quick hacks" in Cloud Functions or adapters
- No leaking Firebase / IndexedDB types across boundaries
- No circular dependencies
- No untyped data flow
- No legacy artefacts or config creep
- No per‑document ACLs or multi‑workspace logic until explicitly requested
