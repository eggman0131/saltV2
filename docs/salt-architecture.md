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
    observability                 # PostHog implementation (posthog-js / posthog-node)
                                  # of error reporting and match logging ports
```

`firebase-sync` and `observability` are **siblings** — they do not depend on each other; both are wired together by the UI/composition layer.

---

## 3. Dependency graph (allowed imports)

### Allowed

- web-pwa → domain, shared-types, ui-components, firebase-sync, observability
- cloud-functions → domain, shared-types, observability/server
- firebase-sync → domain, shared-types
- observability → domain, shared-types
- domain → shared-types
- shared-types → (no dependencies)

### Forbidden

- UI → Cloud Functions
- UI → Firebase SDK directly
- UI → IndexedDB / browser storage directly (narrow exception below)
- UI → PostHog SDK directly
- Domain → Firebase SDK / IndexedDB / Node / browser APIs
- Domain → UI
- Cloud Functions → UI
- Cloud Functions → observability (the default subpath wraps the browser-only PostHog SDK `posthog-js` and cannot run in Node; use `observability/server` instead)
- Cloud Functions → firebase-sync (CF talks to Firestore directly via `firebase-admin`; `firebase-sync` wraps the browser SDK and is not for server-side use)
- firebase-sync ↔ observability (adapters must not import each other)
- Any module → apps/web-pwa or apps/cloud-functions

These rules must be enforced via ESLint, tsconfig project references, and commit gateway checks.

#### Narrow exception: pre-authentication ephemeral state in `web-pwa`

`apps/web-pwa` may use `window.localStorage` for pre-authentication ephemeral state that has no Firestore-backed alternative. The only sanctioned use today is the magic-link **pending email** in `apps/web-pwa/src/lib/auth.svelte.ts`: it must persist before any user is signed in (so `persistentLocalCache` cannot apply — there is no authenticated session to write to Firestore), and email clients open the magic link in a fresh tab/window, so `sessionStorage` would be lost. The exception is:

- **Scoped to `apps/web-pwa` only.** It does **not** extend to any adapter (`firebase-sync`, `observability`), `domain`, or `cloud-functions`.
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
  - Chat sessions (ChatSession, Message — per-user AI kitchen assistant conversations; `ownerUid`-scoped, 14-day TTL via Firestore TTL policy on `expiresAt`; optional `recipeId` for recipe-attached sessions)
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
- **Exception — chat sessions:** The `chatSessions` collection is the only owner-scoped collection. Each user sees only their own chat sessions; Firestore rules enforce `ownerUid == request.auth.uid` on both reads and creates. This is a deliberate exception because AI conversation history is personal, not family-shared.
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
  - Chat sessions: `subscribeChatSessions`, `loadChatSession`, `saveChatSession`, `deleteChatSession`
  - Chef chat streaming: `streamChefChat`
  - Recipe authoring: `callAuthorRecipe`
  - Recipe URL import: `callExtractRecipeFromUrl`
  - Chat title generation: `callGenerateChatTitle`
  - Dev settings: `subscribeDevSettings`, `saveDevSettings`
  - App settings: `subscribeAppSettings`, `saveAppSettings`
  - AI model catalog: `callListAiModels`, `callTestModel`
- Validates all Firestore document reads using Zod schemas from `@salt/domain/schemas`; collection and subscription reads skip invalid documents (log the error, return the valid subset); single-document reads return `Failure<StorageError>` on parse failure.
- Must not import IndexedDB or any local‑storage code.
- Must not contain UI logic.
- Must not contain domain logic — including conflict resolution.
- Must not leak Firebase types across the boundary.

### 6.2 observability adapter

Ships two subpath entrypoints from a single package:

**Default subpath (`@salt/observability`)** — browser-only, bundled into `web-pwa`:
- Implements `ErrorReportingPort` and `MatchLoggingPort` using the PostHog browser SDK (`posthog-js`). The match logger (`createPosthogMatchLoggingAdapter`, also exported as `createObservabilityMatchLoggingAdapter`) emits the slim `canon.match` PostHog event for each match/create outcome.
- Normalizes errors into `DomainError` categories before crossing the boundary.
- Must not be imported by Cloud Functions.
- All public entrypoints (`startSpan`, `startObservabilitySession`, `stopObservabilitySession`, `isObservabilitySessionActive`, `tagObservabilitySession`, and the error reporter) are inert — returning no-op spans or silently no-oping — when `initObservability` has not been called. They never throw before initialisation; this upholds the adapter non-throw contract (Rule 10) when PostHog is gated off (e.g. via an empty `VITE_PUBLIC_POSTHOG_KEY` in the e2e build, which makes the whole adapter a no-op — `posthog.init` is never called).

**Server subpath (`@salt/observability/server`)** — Node-only, bundled into `cloud-functions`:
- Wraps `posthog-node` for event capture and native OpenTelemetry (`@opentelemetry/api`) for spans. It does **not** own a tracer provider: `enableFirebaseTelemetry()` (Genkit-native) registers the single process-wide `NodeTracerProvider` and ships CF spans to GCP / Firebase Monitoring; these helpers operate on whatever provider is globally registered. The server adapter is a complete no-op when `POSTHOG_API_KEY` is absent (the `posthog-node` client is never built).
- Implements `MatchLoggingPort` for the CF side via `createPosthogServerMatchLoggingAdapter` (also exported as `createServerObservabilityMatchLoggingAdapter`), emitting the same slim `canon.match` event via `posthog-node`.
- Exposes `runWithExtractedTraceContext(headers, fn)` to extract the inbound W3C trace context from the request headers and run a Genkit flow within it, so the flow span nests under the platform request span (env-gated — see §8 / CLAUDE.md). `flushServerObservability()` drains queued events before a function returns, and `captureAiGeneration` records per-call LLM cost/usage as a PostHog `$ai_generation` event.
- Exposes `setActiveSpanName(name)` to rename the currently-active OTel span from inside a Genkit flow body, appending a human-readable entity descriptor (e.g. the item name) so traces are scannable in the Genkit / Cloud trace view. No-op when no span is active; length-capped at 80 characters.
- `firebase-functions/logger` is used additively for top-level summary logs to Cloud Logging.

Both subpaths share a runtime-neutral schema mapper (`src/shared/matchOutcomeEvent.ts`, exporting `toCanonMatchEvent` / `CANON_MATCH_EVENT`) so the `canon.match` wire schema cannot drift between fast-path and CF emissions.

Common rules for both subpaths:
- May import the PostHog SDKs (`posthog-js` / `posthog-node`); nothing else in the codebase may.
- Must not import Firebase, IndexedDB, browser storage, UI, or other adapters.
- Must not contain domain logic or business rules.

### 6.3 Common rules

- All adapters convert their backend's responses into domain entities or error types.
- All adapters use `shared-types` for DTOs and result types.
- Adapters must not import each other; all are composed at the application layer.
- `firebase-sync` is the **only** module permitted to import Firebase SDKs.
- `observability` is the **only** module permitted to import the PostHog SDKs (`posthog-js` / `posthog-node`).
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

All error reporting is mediated through `ErrorReportingPort` — adapters never touch a telemetry SDK directly. Reporting is best-effort and must never throw across the boundary (§7.5, Rule 10): a dropped report is always preferable to a thrown error in a caller's hot path.

**Principle: report the unexpected, suppress the expected.** The reason to report a *caught* error is that the friendly-handling path would otherwise hide it — a handled failure never throws, so nothing automatic will surface it. Reporting exists to make those invisible failures visible; it is **not** a mirror of every `Failure`. The decision to report is gated on the **`DomainError` category** (§7.2), not on which call site happens to have a `catch` or an `onError` callback.

**Report** to the error-tracking backend (PostHog) via `ErrorReportingPort`:

- `StorageError` — corruption, quota exceeded, storage unavailable.
- `SyncError` — a write the user attempted that failed unexpectedly.
- `AuthError` — **except** the sign-out / token-refresh race, where in-flight realtime listeners receive `permission-denied` as auth tears down. That specific case is a known false positive and is suppressed.
- Any error that maps to **no** known operational category (unknown / unexpected). These are the highest-signal reports.
- **Server-side:** unhandled Cloud Function exceptions and AI/Genkit flow failures (timeouts, model errors).

**Do not report** (handle with a friendly message only — these are expected operational states, not faults):

- `NetworkError` / offline — expected by design; reads and writes degrade gracefully via `persistentLocalCache`.
- The sign-out / token-refresh `AuthError` race described above.
- `ValidationError` — invalid user input, not a system failure.
- `NotFound` and `ConflictError` — expected; `ConflictError` is resolved by the LWW policy in `packages/domain`.

**Coverage.** Apply the policy uniformly across *all* failure boundaries — command/write failures that return `Failure<DomainError>`, realtime read/stream `onError` callbacks, and server-side Cloud Functions — gated by category. Do not report at only the subset of sites that happen to expose an `onError` callback.

**Reported context.** Data is family-shared (no per-user PII by design), but raw user input (e.g. canon match text) must be scrubbed from reported error context. Report the error's type/message/stack and the `DomainError` category; do not attach free-form user content.

**Cloud Functions** continue to log via `firebase-functions/logger` with structured JSON shaped to match the `DomainError` taxonomy (`{ scope, docId, errorCategory }`). Server-side PostHog error reporting is **additive** to this logging, not a replacement.

**Enforcement.** Unlike the import-graph rules (§11), this policy is a runtime-categorization convention — it is enforced by code review, the category-gating helper at the `ErrorReportingPort` boundary, and unit tests, not by `eslint-plugin-boundaries`.

---

## 8. Cloud Functions requirements

Cloud Functions cover four categories of server-side work:

1. **Gen-AI callables** (`embedText`, `arbitrateCanon`, `matchOrCreateCanon`, `canonicaliseRecipeIngredients`, `parseRecipeIngredients`, `identifyEquipment`, `populateEquipmentEntry`, `regenerateCanonIcon`, `chefChat`, `authorRecipe`, `generateChatTitle`, `extractRecipeFromUrl`) — HTTPS callables invoked by the client. All carry `enforceAppCheck: false` (monitor-first rollout — unverified requests are allowed but reported to App Check metrics; flip the shared `APP_CHECK_ENFORCEMENT` constant in `index.ts` to `{ enforceAppCheck: true }` once staging metrics confirm legitimate traffic passes attestation). Notable variants:
   - **`chefChat`** — streaming `onCallGenkit` (120 s timeout, `isSignedIn()` auth); reads `equipmentManifest` and, when `recipeId` is set, the recipe document server-side; stateless (caller provides message history); plain-text streaming response via `gemini-pro-latest`.
   - **`authorRecipe`** — non-streaming `onCall` (512 MiB / 120 s); converts a chat conversation to a complete `RecipeDoc` via a Flash + temperature:0 librarian flow, then batch-canonicalises all ingredients via `canonicaliseRecipeIngredientsFlow`.
   - **`generateChatTitle`** — non-streaming `onCallGenkit` (15 s timeout, 0 retries); takes the first user message and assistant reply and returns a 2–5 word title string via Gemini Flash (temperature 0.3). Called in the background after the first exchange to replace the naive `text.slice(0, 60)` fallback with an AI-generated conversation title.
   - **`extractRecipeFromUrl`** — non-streaming `onCallGenkit`; SSRF-guarded URL fetch (https-only, resolved-IP range checks, size/time/redirect caps) followed by JSON-LD structured-data extraction and an HTML→Gemini fallback. Returns a `RecipeDoc` draft with metric/British conversions applied. Failure codes are mapped to stable `HttpsError` gRPC codes so the client can show specific copy for each failure mode (`invalid-url`, `blocked-url`, `fetch-failed`, `not-a-recipe`, `ai-failed`).
2. **Admin-only callables** (`listAiModels`, `testModel`) — not Genkit flows; admin-gated `onCall` callables that proxy requests requiring the API key server-side so the key never reaches the browser.
   - **`listAiModels`** — fetches the live Gemini model catalog via `GET /v1beta/models`, classifies each model by role capability, and returns a filtered catalog per role. ~1h in-process cache; `forceRefresh` flag bypasses it. Used by the admin AI model settings page to populate the capability-filtered picker.
   - **`testModel`** — probes a single named model server-side and returns an `ok`/`error` outcome. Used by the admin Test button to verify availability before saving.
3. **Firestore write triggers** (`onShoppingListItemWrite`, `onCanonItemWritten`) — respond to document writes and run domain logic server-side, writing results back to Firestore.
4. **Identity Platform blocking functions** (`beforeMemberCreated`) — reject account creation for any email not on the member allowlist; requires Identity Platform to be enabled on the target project.

All categories are intentionally minimal.

**Admin-managed AI model selection.** Every AI flow resolves its model at call time via `resolveModel(role, flowId?)` rather than using a hardcoded literal. Model names are stored in the `appSettings/singleton` Firestore document, cached for 180 s per CF instance; every role field falls back to the current production model literal when the doc is missing, corrupt, or never configured — AI never breaks on a bad settings doc. Flows are bucketed into five roles: `fast` (accuracy-first: `authorRecipe`, `extractRecipeFromUrl`, `identifyEquipment`), `lite` (cost/latency-optimised: `arbitrateCanon`, `parseRecipeIngredients`, `parseEntry`, `generateChatTitle`, `populateEquipmentEntry`), `pro` (quality-first: `chefChat`), `embedding` (`embedText`, `serverEmbedding`), and `image` (`generateCanonIcon`). An optional `perFlow` override map in the settings doc lets a single flow diverge from its role without changing the whole tier. `AI_FLOW_ROLES` in `@salt/domain/schemas` is the canonical flow→role mapping; renaming a key there orphans any saved per-flow override.

Cloud Functions:

- Import domain + observability/server (never the default `observability` subpath, which wraps the browser-only PostHog SDK `posthog-js` and cannot run in Node)
- Talk to Firestore directly via `firebase-admin` — do not import `@salt/firebase-sync`, which wraps the browser SDK
- Never import UI
- Never contain business logic
- Only orchestrate: input validation (via Zod schemas from `@salt/domain/schemas`; callable entry points throw `HttpsError('invalid-argument')` on parse failure), domain commands/queries, gen‑AI providers, and returning results
- Must be stateless
- Callables must be testable without Firebase emulators (via domain mocks); triggers use the Firestore emulator for write-back integration tests

---

## 9. PWA (UI) requirements

The PWA:

- Imports domain, firebase-sync, observability, ui-components, shared-types
- Never imports Firebase SDK, IndexedDB, or PostHog SDK directly
- Never contains business logic (including conflict resolution policy)
- Uses domain commands/queries as its API
- Wires `AuthProvider`, `ErrorReportingPort`, `MatchLoggingPort`, `EmbeddingPort`, and `CanonArbitrationPort` at composition time
- Starts `initCanonSync()`, `initMealPlanSync()`, `initChatSync(uid)`, `initDevSettingsSync()`, and `initAppSettingsSync()` from `App.svelte` when the user authenticates — subscriptions begin once at auth time, not on individual page mounts
- In-memory Svelte stores (`canonItems`, `aisles`, `aisleUsage`) are the UI's read layer; `upsertCanonItem` and `saveAisles` are the write path
- **Recipes** (`/recipes`, `/recipes/new`, `/recipes/:id/edit`, `/recipes/:id`): family-shared recipe store. Available to all members — the nav entry is in the default nav and the route pages have no `AdminGuard` wrappers. `recipeService` drives the pages; `subscribeRecipes` / `loadRecipe` / `saveRecipe` / `deleteRecipe` are the firebase-sync data operations. Ingredient parsing and canonicalisation are on-demand: the editor surfaces a per-row **Match** button and a batch **Canonicalise** button that call `parseRecipeIngredients` and `canonicaliseRecipeIngredients` respectively. The recipe list page exposes an **Import from URL** action: the user pastes a URL, `importRecipeFromUrl` (in `recipeService`) calls `callExtractRecipeFromUrl`, the extracted draft (with metric/British conversions already applied) is stashed, and the user is routed to `/recipes/new` with the editor pre-filled. Recipe-to-shopping-list extraction opens a review sheet (`RecipeAddToListSheet`) where each ingredient row shows Add/Check toggles driven by `recipeItemAddDefault` (canon `shoppingBehavior` → add/check/skip defaults); confirmed items land on the list, with "check" rows flagged `needsCheck` for a quick confirm/drop affordance on the shopping screen. `buildRecipeAddPlan` evaluates each ingredient's live match via `hasLiveCanonMatch` so dangling canon references are added as raw text rather than carrying stale `canonId`s. The recipe view page (`/recipes/:id`) uses a two-column desktop layout: the recipe body on the left, an embedded chef chat sidebar on the right. The sidebar creates (or resumes) an owner-scoped chat session with `recipeId` set without navigating away; an **Update recipe** button in the sidebar re-runs the `authorRecipe` librarian flow against the sidebar conversation and persists the result via LWW write.
- **Chat / AI Kitchen Assistant** (`/chat`, `/chat/:id`): per-user AI cooking assistant, accessible to all members (ChefHat nav entry, no `AdminGuard`). `chatService` drives the pages; `initChatSync(uid)` starts the owner-scoped `subscribeChatSessions` subscription at auth time. Chat list page: session list, new-chat action, per-session delete with confirm dialog. Chat session page: message bubbles with streaming partial render (▌ cursor), auto-resizing Enter-to-send textarea fixed above the bottom nav, scroll-to-bottom effect. After the first exchange, `generateChatTitle` is called in the background to replace the naive truncated-text title with a 2–5 word AI-generated title. Free-standing sessions show a **Save as recipe** button (visible once the assistant has replied); recipe-attached sessions (accessed from the recipe view sidebar) show a **View recipe** link and an **Apply changes** button that re-runs the `authorRecipe` librarian flow and persists the updated `RecipeDoc` via LWW write.
- **Meal plan** (`/mealplan`): the weekly evening-meal planner, accessible to all members. Shows a seven-day week with prev/next/this-week navigation and a Load-template button. `mealPlanService` drives the page; subscriptions are started at auth time via `initMealPlanSync()`.
- **Admin operator area** (`/admin` route group): `AdminGuard` redirects non-admins; the Members CRUD screen (`/admin/members`) lets admins add, edit, and remove allowlist members; `membersService` exposes a sorted roster store backed by `subscribeMembers`. Canon management (`/admin/canon`, `/admin/canon/new`, `/admin/canon/aisles`, `/admin/canon/:id`) is also gated here — canon stewardship is an operator function, not an everyday user activity, so the list, create, detail, and aisle management pages all sit under `AdminGuard`. The `needs_approval` count badge is surfaced on the Admin nav entry so operators can see the review queue from anywhere in the app. Meal plan template administration (`/admin/mealplan`) lets operators edit the standard weekday-keyed template and the `firstDayOfWeek` setting; gated by `AdminGuard` (cosmetic — Firestore rules allow any authenticated member to write meal plan documents). Development settings (`/admin/dev-settings`) exposes per-environment operator switches — currently the canon-icon AI generation kill-switch (`canonIconGenerationEnabled`); write is admin-only enforced by Firestore rules (not cosmetic); `devSettingsService` drives the page and defaults to enabled until the doc loads, mirroring the CF fail-open behaviour. AI model settings (`/admin/app-settings`) lets admins view and edit the Gemini model used for each AI role (`fast`, `lite`, `pro`, `embedding`, `image`) and set optional per-flow overrides; backed by `appSettingsService` which reads/writes the `appSettings/singleton` doc via `subscribeAppSettings` / `saveAppSettings`; the model picker is populated server-side by `callListAiModels` (no API key in browser), and a Test probe calls `callTestModel` to verify availability before saving; gated by `AdminGuard`. Client-side gating is cosmetic — real enforcement is in Firestore rules and the `beforeMemberCreated` blocking function.
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
- Forbid PostHog SDK imports outside observability
- Forbid the default `observability` subpath imports in cloud-functions (browser-only); `observability/server` is allowed
- Forbid firebase-sync ↔ observability imports (sibling adapters must not import each other)
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
- Reject any PostHog SDK import outside observability
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

### observability

- Unit tests with mocked PostHog SDK
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
- observability (default subpath) → bundled into UI only (browser-only PostHog SDK `posthog-js`)
- observability/server → bundled into cloud-functions (`posthog-node` + native OTel; spans export via `enableFirebaseTelemetry()`)
- domain → bundled into UI and Cloud Functions
- shared-types → type-only package

---

## 14. Non-negotiables

- No Firebase SDK in UI
- No IndexedDB / browser storage anywhere — use Firestore's persistent cache (one narrow exception: pre-auth ephemeral state in `web-pwa`, see §3)
- No PostHog SDK in UI or other adapters (only in observability)
- No business logic outside domain (including conflict resolution)
- No cross-module imports outside the allowed graph
- No global state
- No leaking Firebase / PostHog types across boundaries
- No circular dependencies
- No untyped data flow
- No per‑document ACLs or multi‑workspace logic until explicitly requested
