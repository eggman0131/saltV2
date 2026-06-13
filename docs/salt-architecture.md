# Salt 2.0 — Architecture Contract v1.0

## 1. Purpose

Salt 2.0 is a modular, enforceable architecture for a **Firestore-first PWA** with Firebase providing realtime data, persistent offline cache, and identity.
The goal is to maintain strict separation between:

- UI (apps/web-pwa)
- Domain logic (packages/domain)
- Cloud sync / realtime / auth adapter (packages/adapters/firebase-sync)
- Cloud Functions (apps/cloud-functions) — reserved for server‑side gen‑AI workloads

The architecture must remain framework‑agnostic, testable, and resilient to change, while supporting:

- **Firestore as the source of truth.** `onSnapshot` listeners feed in-memory Svelte stores; all reads come from the stores, not from ad-hoc queries.
- **Persistent offline cache.** Firestore's `persistentLocalCache()` replaces any manual IndexedDB layer — offline reads come from Firestore's own cache; offline writes are queued automatically and drained on reconnect.
- **Last-write-wins per document.** No bespoke conflict resolution. If a specific document ever needs stronger guarantees, that is a per-document decision.
- **Single-family workspace.** All authenticated members see all data; admin actions are gated per user.

### 1.1 Schema evolution and production data

Until the first production deploy, Salt is **greenfield** — no real data exists, so schema‑shape changes are free (drop a field, rename a collection, change a type) and **no migrations or back‑compat shims are written**.

**That posture ends at launch.** Once production holds real family data, every schema‑shape change must account for documents already written: either keep the new shape backward‑compatible (tolerate old docs on read) or run an explicit one‑off migration. "Just change the shape" is no longer safe for production. Last‑write‑wins per document and the no‑tombstones / no‑soft‑delete rules are unchanged — this adds one standing gate: *does this change break existing production documents?*

---

## 2. Mono‑repo structure (logical modules)

```
/apps
  web-pwa                         # PWA front-end (UI only)
  cloud-functions                 # Gen-AI workloads (embedText, arbitrateCanon)

/packages
  domain                          # Pure business logic, entities, validation, ports
  shared-types                    # Cross-cutting types/interfaces only
  ui-components                   # Shared UI primitives
  testing-utils                   # Shared test helpers
  adapters/
    firebase-sync                 # Firebase Auth + Firestore implementation
                                  # of realtime subscriptions, direct writes, and auth ports
    ld-observability              # LaunchDarkly Observability SDK implementation
                                  # of error reporting and match logging ports
```

`firebase-sync` and `ld-observability` are **siblings** — they do not depend on each other; both are wired together by the UI/composition layer.

---

## 3. Dependency graph (allowed imports)

### Allowed

- web-pwa → domain, shared-types, ui-components, firebase-sync, ld-observability
- cloud-functions → domain, shared-types, ld-observability/server
- firebase-sync → domain, shared-types
- ld-observability → domain, shared-types
- domain → shared-types
- shared-types → (no dependencies)

### Forbidden

- UI → Cloud Functions
- UI → Firebase SDK directly
- UI → IndexedDB / browser storage directly (narrow exception below)
- UI → LaunchDarkly SDK directly
- Domain → Firebase SDK / IndexedDB / Node / browser APIs
- Domain → UI
- Cloud Functions → UI
- Cloud Functions → ld-observability (the default subpath wraps the browser-only LaunchDarkly SDK and cannot run in Node; use `ld-observability/server` instead)
- Cloud Functions → firebase-sync (CF talks to Firestore directly via `firebase-admin`; `firebase-sync` wraps the browser SDK and is not for server-side use)
- firebase-sync ↔ ld-observability (adapters must not import each other)
- Any module → apps/web-pwa or apps/cloud-functions

These rules must be enforced via ESLint, tsconfig project references, and commit gateway checks.

#### Narrow exception: pre-authentication ephemeral state in `web-pwa`

`apps/web-pwa` may use `window.localStorage` for pre-authentication ephemeral state that has no Firestore-backed alternative. The only sanctioned use today is the magic-link **pending email** in `apps/web-pwa/src/lib/auth.svelte.ts`: it must persist before any user is signed in (so `persistentLocalCache` cannot apply — there is no authenticated session to write to Firestore), and email clients open the magic link in a fresh tab/window, so `sessionStorage` would be lost. The exception is:

- **Scoped to `apps/web-pwa` only.** It does **not** extend to any adapter (`firebase-sync`, `ld-observability`), `domain`, or `cloud-functions`.
- **Limited to pre-auth ephemeral state.** It is not a general license to use browser storage for app data — all post-sign-in data still flows through Firestore's `persistentLocalCache`.
- **Tolerant of failure.** Writes are wrapped so that a missing/blocked `localStorage` degrades gracefully (the magic link re-prompts for the email on return).

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
  - Canon items (name, synonyms, aisle, optional embedding, thumbnail icon)
  - Shopping lists (items, checked state, canon links)
  - Members (email-keyed allowlist membership records, admin role, email normalisation)
  - Meal plan (MealPlanConfig, MealPlanTemplate, MealPlanWeek, Day, Attendee, Weekday — weekly evening-meal planner with a weekday-keyed template and per-day guest count)
- Commands (write operations)
- Queries (read operations)
- Validation rules and Zod schemas (via `@salt/domain/schemas` subpath) — covers all Firestore document shapes, callable CF inputs, and AI flow output types; TypeScript types are derived via `z.infer`
- Ports (interfaces) for:
  - `CanonLocalStorePort` / `AisleLocalStorePort` — in-memory store contracts used by domain commands; satisfied by the in-memory adapters in `web-pwa`
  - `AuthProvider` — identity and workspace membership
  - `EmbeddingPort` / `CanonArbitrationPort` / `MatchLoggingPort` — AI and observability ports used by `matchOrCreate`
  - `EntryParsePort` — AI-fallback port for structured shopping-list entry parsing; implemented by the server-side Genkit adapter in `cloud-functions` and consumed by `onShoppingListItemWrite`

The domain is the single source of truth for business logic, data shapes, and validation semantics.

---

## 5. Workspace and access model

Salt 2.0 is built for a **single shared family workspace**:

- All authenticated members see all recipes, canon, shopping lists, and meal plan data.
- There is no per‑recipe ACL; there are no private collections.
- **Admin functions** (e.g. inviting members, managing canon at scale, destructive bulk operations) are gated by a per‑user `role` field on the workspace membership record.
- Role checks are domain logic, not adapter logic. Adapters surface the role; domain decides what's allowed.
- Security rules in the cloud backend mirror the domain rule: any workspace member can read/write workspace data; admin‑only mutations check role.

This model is intentionally narrow. Multi‑workspace, sharing, or per‑document permissions are explicitly **out of scope** until a real requirement appears.

---

## 6. Adapter requirements

### 6.1 firebase-sync adapter

- Implements realtime subscriptions and direct writes using Firestore `onSnapshot` and `setDoc`.
- Implements `AuthProvider` using Firebase Auth.
- Initialises Firestore with `persistentLocalCache()` in production (disabled in emulator tests to avoid stale cache).
- Initialises Firebase App Check (reCAPTCHA Enterprise, `isTokenAutoRefreshEnabled: true`) when an optional `AppCheckConfig` is provided and emulators are not in use. Must initialise before any other Firebase service so tokens are attached to requests. The exported `AppCheckConfig` interface carries a public `siteKey` and an optional `debugToken` for unattested environments (local dev / CI hitting a real backend); the debug token must never be baked into a deployed bundle.
- Exposes the following as its primary data API:
  - Canon: `subscribeCanonItems`, `subscribeAisles`, `upsertCanonItem`, `deleteCanonItem`, `saveAisles`
  - Shopping lists: `subscribeShoppingLists`, `listShoppingLists`, `createShoppingList`, `renameShoppingList`, `deleteShoppingList`
  - Shopping list items: `subscribeShoppingListItems`, `listShoppingListItems`, `saveShoppingListItem`, `deleteShoppingListItem`, `deleteShoppingListItems`, `moveShoppingListItems`
  - Shopping list config: `subscribeShoppingListsConfig`, `loadShoppingListsConfig`, `saveShoppingListsConfig`
  - Members: `subscribeMembers`, `upsertMember`, `deleteMember`
  - Meal plan: `subscribeMealPlanConfig`, `subscribeMealPlanTemplate`, `subscribeMealPlanWeek`, `saveMealPlanConfig`, `saveMealPlanTemplate`, `saveMealPlanWeek`
  - Recipes: `subscribeRecipes`, `loadRecipe`, `saveRecipe`, `deleteRecipe`
- Validates all Firestore document reads using Zod schemas from `@salt/domain/schemas`; collection and subscription reads skip invalid documents (log the error, return the valid subset); single-document reads return `Failure<StorageError>` on parse failure.
- Must not import IndexedDB or any local‑storage code.
- Must not contain UI logic.
- Must not contain domain logic — including conflict resolution.
- Must not leak Firebase types across the boundary.

### 6.2 ld-observability adapter

Ships two subpath entrypoints from a single package:

**Default subpath (`@salt/ld-observability`)** — browser-only, bundled into `web-pwa`:
- Implements `ErrorReportingPort` and `MatchLoggingPort` using the LaunchDarkly browser SDK.
- Normalizes errors into `DomainError` categories before crossing the boundary.
- Must not be imported by Cloud Functions.

**Server subpath (`@salt/ld-observability/server`)** — Node-only, bundled into `cloud-functions`:
- Initialises an OTel `NodeTracerProvider` that ships CF spans to LaunchDarkly's OTLP endpoint.
- Implements `MatchLoggingPort` for the CF side via `createServerLDMatchLoggingAdapter`.
- Exposes `addServerSpanProcessor` so CF-local concerns (e.g. Genkit dev-trace routing) can register additional span processors without touching the adapter internals.
- Exposes `setActiveSpanName(name)` to rename the currently-active OTel span from inside a Genkit flow body, appending a human-readable entity descriptor (e.g. the item name) so traces are scannable in the LaunchDarkly trace list. No-op when observability is uninitialised or no span is active; length-capped at 80 characters.
- `firebase-functions/logger` is used additively for top-level summary logs to Cloud Logging.

Both subpaths share a runtime-neutral schema mapper (`src/shared/`) so the `canon.match` wire schema cannot drift between fast-path and CF emissions.

Common rules for both subpaths:
- May import the LaunchDarkly SDK; nothing else in the codebase may.
- Must not import Firebase, IndexedDB, browser storage, UI, or other adapters.
- Must not contain domain logic or business rules.

### 6.3 Common rules

- All adapters convert their backend's responses into domain entities or error types.
- All adapters use `shared-types` for DTOs and result types.
- Adapters must not import each other; all are composed at the application layer.
- `firebase-sync` is the **only** module permitted to import Firebase SDKs.
- `ld-observability` is the **only** module permitted to import the LaunchDarkly Observability SDK.
- IndexedDB, `idb`, `idb-keyval` are **forbidden** everywhere. Offline persistence is provided by Firestore's `persistentLocalCache`.

---

## 7. Adapter Error Contract

Adapters must never leak Firebase, browser, or network‑layer errors across the boundary.
All failures must be normalised into **domain‑level error types** defined in shared‑types.

### 7.1 Error Shape

All adapter functions return either:

- `Success<T>`
- `Failure<DomainError>`
- `Conflict<T>` (for concurrent-write detection if needed in future)

Adapters must not throw for expected operational failures.

### 7.2 DomainError Categories

DomainError is a closed set of error categories:

- `AuthError` — unauthenticated, forbidden, expired session
- `NotFound` — recipe, canon item, shopping list, workspace
- `NetworkError` — offline, unreachable, transient network failure
- `StorageError` — storage unavailable, quota exceeded, corruption detected
- `SyncError` — failed write, invalid data
- `ConflictError` — concurrent write detected
- `ValidationError` — invalid input according to domain rules

No Firebase error codes may cross the boundary.

### 7.3 Loading States

`isLoadingAisles` (exported from `canonService.ts`) is the single loading signal for the app — it starts `true` on `initCanonSync()` and clears once both the canon items and aisles `onSnapshot` callbacks have fired for the first time.

### 7.4 Offline Behaviour

- Reads come from Firestore's `persistentLocalCache` — no separate local store needed.
- Writes are queued by Firestore automatically when offline and drained on reconnect.
- No manual drain queue or manifest revision counter.

### 7.5 Error Propagation Rules

- Adapters **never throw** for operational errors.
- Adapters **may throw** only for programmer errors (violated preconditions).
- UI must handle all `Failure` states explicitly.

### 7.6 Logging and Error Reporting

- Adapters may log internal errors for diagnostics via the `ErrorReportingPort`.
- All error reporting is mediated through `ErrorReportingPort`.
- **Cloud Functions** log via `firebase-functions/logger` with structured JSON shaped to match the `DomainError` taxonomy (`{ scope, docId, errorCategory }`).

---

## 8. Cloud Functions requirements

Cloud Functions cover two categories of server-side work:

1. **Gen-AI callables** (`embedText`, `arbitrateCanon`, `matchOrCreateCanon`, `canonicaliseRecipeIngredients`, `parseRecipeIngredients`, `identifyEquipment`, `populateEquipmentEntry`, `regenerateCanonIcon`) — HTTPS callables invoked by the client. All carry `enforceAppCheck: false` (monitor-first rollout — unverified requests are allowed but reported to App Check metrics; flip the shared `APP_CHECK_ENFORCEMENT` constant in `index.ts` to `{ enforceAppCheck: true }` once staging metrics confirm legitimate traffic passes attestation).
2. **Firestore write triggers** (`onShoppingListItemWrite`, `onCanonItemWritten`) — respond to document writes and run domain logic server-side, writing results back to Firestore.
3. **Identity Platform blocking functions** (`beforeMemberCreated`) — reject account creation for any email not on the member allowlist; requires Identity Platform to be enabled on the target project.

Both categories are intentionally minimal.

Cloud Functions:

- Import domain + ld-observability/server (never the default `ld-observability` subpath, which wraps the browser-only SDK and cannot run in Node)
- Talk to Firestore directly via `firebase-admin` — do not import `@salt/firebase-sync`, which wraps the browser SDK
- Never import UI
- Never contain business logic
- Only orchestrate: input validation (via Zod schemas from `@salt/domain/schemas`; callable entry points throw `HttpsError('invalid-argument')` on parse failure), domain commands/queries, gen‑AI providers, and returning results
- Must be stateless
- Callables must be testable without Firebase emulators (via domain mocks); triggers use the Firestore emulator for write-back integration tests

---

## 9. PWA (UI) requirements

The PWA:

- Imports domain, firebase-sync, ld-observability, ui-components, shared-types
- Never imports Firebase SDK, IndexedDB, or LaunchDarkly SDK directly
- Never contains business logic (including conflict resolution policy)
- Uses domain commands/queries as its API
- Wires `AuthProvider`, `ErrorReportingPort`, `MatchLoggingPort`, `EmbeddingPort`, and `CanonArbitrationPort` at composition time
- Starts `initCanonSync()` and `initMealPlanSync()` from `App.svelte` when the user authenticates — subscriptions begin once at auth time, not on individual page mounts
- In-memory Svelte stores (`canonItems`, `aisles`, `aisleUsage`) are the UI's read layer; `upsertCanonItem` and `saveAisles` are the write path
- **Recipes** (`/recipes`, `/recipes/new`, `/recipes/:id/edit`, `/recipes/:id`): family-shared recipe store. Currently admin-only — all three route pages are wrapped in `AdminGuard` and the nav entry is appended only for admins, while the module is incomplete (issue #179). `recipeService` drives the pages; `subscribeRecipes` / `loadRecipe` / `saveRecipe` / `deleteRecipe` are the firebase-sync data operations. Ingredient parsing and canonicalisation are on-demand: the editor surfaces a per-row **Match** button and a batch **Canonicalise** button that call `parseRecipeIngredients` and `canonicaliseRecipeIngredients` respectively. Recipe-to-shopping-list extraction opens a review sheet (`RecipeAddToListSheet`) where each ingredient row shows Add/Check toggles driven by `recipeItemAddDefault` (canon `shoppingBehavior` → add/check/skip defaults); confirmed items land on the list, with "check" rows flagged `needsCheck` for a quick confirm/drop affordance on the shopping screen. `buildRecipeAddPlan` evaluates each ingredient's live match via `hasLiveCanonMatch` so dangling canon references are added as raw text rather than carrying stale `canonId`s.
- **Meal plan** (`/mealplan`): the weekly evening-meal planner, accessible to all members. Shows a seven-day week with prev/next/this-week navigation and a Load-template button. `mealPlanService` drives the page; subscriptions are started at auth time via `initMealPlanSync()`.
- **Admin operator area** (`/admin` route group): `AdminGuard` redirects non-admins; the Members CRUD screen (`/admin/members`) lets admins add, edit, and remove allowlist members; `membersService` exposes a sorted roster store backed by `subscribeMembers`. Canon management (`/admin/canon`, `/admin/canon/new`, `/admin/canon/aisles`, `/admin/canon/:id`) is also gated here — canon stewardship is an operator function, not an everyday user activity, so the list, create, detail, and aisle management pages all sit under `AdminGuard`. The `needs_approval` count badge is surfaced on the Admin nav entry so operators can see the review queue from anywhere in the app. Meal plan template administration (`/admin/mealplan`) lets operators edit the standard weekday-keyed template and the `firstDayOfWeek` setting; gated by `AdminGuard` (cosmetic — Firestore rules allow any authenticated member to write meal plan documents). Client-side gating is cosmetic — real enforcement is in Firestore rules and the `beforeMemberCreated` blocking function.
- Offline data is provided by Firestore's `persistentLocalCache`. The service worker never caches Firestore traffic or any app data.
- **PWA installability (Tier-1):** A Workbox-generated service worker (`vite-plugin-pwa`, `generateSW` strategy) precaches the built app shell and static assets only. The service worker is the sole consumer of the Cache API; no other module may touch `caches` directly (CLAUDE.md hard rule #3). The SW is disabled in dev (no interference with HMR). Manifest identity is env-distinct: `VITE_PWA_NAME`, `VITE_PWA_SHORT_NAME`, and `VITE_PWA_THEME_COLOR` are read at build time from `.env.<mode>` so staging and production install as distinct apps. The auto-update flow (owned by `src/lib/pwa.ts`) defers page reloads to safe moments (hash route change or tab refocus) and never reloads mid-interaction.

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
- Forbid IndexedDB / browser storage imports everywhere
- Forbid LaunchDarkly Observability SDK imports outside ld-observability
- Forbid the default `ld-observability` subpath imports in cloud-functions (browser-only); `ld-observability/server` is allowed
- Forbid firebase-sync ↔ ld-observability imports (sibling adapters must not import each other)
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
- Reject any IndexedDB import anywhere
- Reject any LaunchDarkly SDK import outside ld-observability
- Reject any UI → backend leakage
- Reject any domain impurity (Node/browser/Firebase imports)

---

## 12. Testing strategy

### Domain

- 100% unit testable without Firebase or IndexedDB
- Pure logic tests, including validation

### firebase-sync

- Unit tests with mocks
- Integration tests against the Firebase emulator (Firestore only; persistent cache disabled in emulator tests)

### ld-observability

- Unit tests with mocked LaunchDarkly SDK
- Tests that error normalization preserves error context

### Cloud Functions

- Unit tests with mocked adapters
- Integration tests with emulator

### UI

- Component tests
- Integration tests (with all adapters wired to fakes)
- E2E tests (Playwright against Firebase emulator)

---

## 13. Deployment units

- web-pwa → deployed as PWA
- cloud-functions → deployed to Firebase Functions
- firebase-sync → bundled into UI only (browser SDK; not imported by Cloud Functions)
- ld-observability (default subpath) → bundled into UI only (browser-only SDK)
- ld-observability/server → bundled into cloud-functions (Node SDK, OTLP exporter)
- domain → bundled into UI and Cloud Functions
- shared-types → type-only package

---

## 14. Non-negotiables

- No Firebase SDK in UI
- No IndexedDB / browser storage anywhere — use Firestore's persistent cache (one narrow exception: pre-auth ephemeral state in `web-pwa`, see §3)
- No LaunchDarkly SDK in UI or other adapters (only in ld-observability)
- No business logic outside domain (including conflict resolution)
- No cross-module imports outside the allowed graph
- No global state
- No leaking Firebase / LaunchDarkly types across boundaries
- No circular dependencies
- No untyped data flow
- No per‑document ACLs or multi‑workspace logic until explicitly requested
