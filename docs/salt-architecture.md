# Salt 2.0 — Architecture Contract v0.1

## 1. Purpose

Salt 2.0 is a modular, enforceable architecture for a modern PWA with a Firebase backend.
The goal is to maintain strict separation between:

- UI (apps/web-pwa)
- Domain logic (packages/domain)
- Infrastructure adapters (packages/firebase-adapter)
- Cloud Functions (apps/cloud-functions)

The architecture must remain framework‑agnostic, testable, and resilient to change.

---

## 2. Mono‑repo Structure (Logical Modules)

/apps
web-pwa # PWA front-end (UI only)
cloud-functions # Firebase Cloud Functions entrypoints

/packages
domain # Pure business logic, entities, validation, rules
firebase-adapter # Firebase implementation of domain ports
shared-types # Cross-cutting types/interfaces only
ui-components # Optional shared UI library
testing-utils # Shared test helpers

This structure is conceptual; the scaffold must implement it exactly.

---

## 3. Dependency Graph (Allowed Imports)

### Allowed

- web-pwa → domain, firebase-adapter, shared-types, ui-components
- cloud-functions → domain, firebase-adapter, shared-types
- firebase-adapter → domain, shared-types
- domain → shared-types
- shared-types → (no dependencies)

### Forbidden

- UI → Cloud Functions
- UI → Firebase SDK directly
- Domain → Firebase SDK
- Domain → UI
- Cloud Functions → UI
- Any module → apps/web-pwa
- Any module → apps/cloud-functions

These rules must be enforced via ESLint, tsconfig references, and commit gateway checks.

---

## 4. Domain Layer Requirements

The domain layer is pure TypeScript:

- No Firebase imports
- No browser APIs
- No Node APIs
- No side effects
- No I/O
- No global state

The domain exposes:

- Entities (immutable where possible)
- Value objects
- Commands (write operations)
- Queries (read operations)
- Validation rules
- Interfaces/ports for persistence, auth, messaging, etc.

The domain layer is the single source of truth for business logic.

---

## 5. Firebase Adapter Requirements

The Firebase adapter:

- Implements domain ports using Firebase SDKs
- Contains all Firebase-specific logic
- Exposes functions that the UI and Cloud Functions can call
- Must not contain UI logic
- Must not contain domain logic
- Must not leak Firebase types outside the adapter boundary
  - Use shared-types for DTOs
  - Convert Firebase responses into domain entities

The adapter is the only module allowed to import Firebase SDKs.

---

## 6. Cloud Functions Requirements

Cloud Functions:

- Import domain + firebase-adapter
- Never import UI
- Never contain business logic
- Only orchestrate:
  - Input validation
  - Calling domain commands/queries
  - Returning results
- Must be stateless
- Must be testable without Firebase emulators (via domain mocks)

---

## 7. PWA (UI) Requirements

The PWA:

- Imports domain + firebase-adapter
- Never imports Firebase SDK directly
- Never contains business logic
- Uses domain commands/queries as its API
- Uses adapter functions for persistence/auth
- Must support offline-first behaviour (service worker + caching strategy)

UI is responsible for:

- Rendering
- Local state
- User interactions
- Calling domain commands
- Displaying results

---

## 8. Shared Types Requirements

shared-types contains:

- DTOs
- API request/response shapes
- Cross-module enums
- Error codes
- Nothing with logic
- Nothing that depends on Firebase or browser APIs

This module must remain extremely small and stable.

---

## 9. Enforcement Rules

### ESLint

- Enforce allowed import graph
- Forbid Firebase imports outside firebase-adapter
- Forbid domain importing anything except shared-types
- Forbid UI importing Cloud Functions
- Forbid circular dependencies
- Enforce strict TypeScript rules

### tsconfig

- Use project references to enforce module boundaries
- Each module has its own tsconfig
- Root tsconfig defines the dependency graph

### Commit Gateway

Every commit must:

- Pass linting
- Pass type checks
- Pass dependency graph checks
- Pass unit tests
- Pass formatting
- Reject any accidental Firebase import outside adapter
- Reject any UI → backend leakage
- Reject any domain impurity (Node/browser/Firebase imports)

---

## 10. Testing Strategy

### Domain

- 100% unit testable without Firebase
- Pure logic tests

### Firebase Adapter

- Unit tests with mocks
- Integration tests with Firebase emulator (optional)

### Cloud Functions

- Unit tests with mocked adapter
- Integration tests with emulator

### UI

- Component tests
- Integration tests
- E2E tests (Playwright)

---

## 11. Deployment Units

- web-pwa → deployed as PWA
- cloud-functions → deployed to Firebase Functions
- firebase-adapter → bundled into both UI + Functions
- domain → bundled into both UI + Functions
- shared-types → type-only package

---

## 12. Versioning & Stability

- Domain layer is the most stable
- Shared types must be versioned carefully
- UI and Cloud Functions may change frequently
- Breaking changes must be explicit in commit messages (Conventional Commits)

---

## 13. Non-negotiables

- No Firebase SDK in UI
- No business logic outside domain
- No cross-module imports outside the allowed graph
- No global state
- No “quick hacks” in Cloud Functions
- No leaking Firebase types across boundaries
- No circular dependencies
- No untyped data flow
- No legacy artefacts or config creep
