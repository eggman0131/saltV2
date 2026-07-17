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

**That posture ends at launch.** Once production holds real family data, every schema‑shape change must account for documents already written: either keep the new shape backward‑compatible (tolerate old docs on read) or run an explicit one‑off migration. "Just change the shape" is no longer safe for production. Last‑write‑wins per document and the no‑tombstones / no‑soft‑delete rules are unchanged — this adds one standing gate: _does this change break existing production documents?_

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

#### Narrow exceptions: ephemeral state in `web-pwa` with no Firestore-backed alternative

Two narrow exceptions permit browser storage in `apps/web-pwa` only. All other browser storage is forbidden (CLAUDE.md Rule 3).

**Exception 1 — `window.localStorage` for pre-authentication ephemeral state.** The only sanctioned use is the magic-link **pending email** in `apps/web-pwa/src/lib/auth.svelte.ts`: it must persist before any user is signed in (so `persistentLocalCache` cannot apply — there is no authenticated session to write to Firestore), and email clients open the magic link in a fresh tab/window, so `sessionStorage` would be lost.

**Exception 2 — `window.sessionStorage` for the stale-deploy reload guard.** The `salt:pwa:preloadReloadGuard` key in `apps/web-pwa/src/lib/pwa.ts` is a one-shot flag that survives a single page reload within the same tab to prevent a chunk-load reload loop after a deploy, then auto-clears when the tab closes. `sessionStorage` is the right scope: the flag must outlast the reload but must not suppress a legitimate first reload in a future session (as `localStorage` would).

Both exceptions share the same constraints:

- **Scoped to `apps/web-pwa` only.** Neither extends to any adapter (`firebase-sync`, `observability`), `domain`, or `cloud-functions`.
- **Limited to ephemeral page mechanics with no Firestore-backed alternative.** Neither is a general license to use browser storage for app data — all post-sign-in data still flows through Firestore's `persistentLocalCache`.
- **Tolerant of failure.** All storage accesses are wrapped so that a missing/blocked storage API degrades gracefully (Rule 10).

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
  - Weather forecast (WeatherForecast, WeatherDaySummary — per-day evening summaries keyed by date, with temperature, humidity, precipitation chance, and weather code; fetched from Open-Meteo and cached in `weatherForecast/singleton`; pure classification helpers — `weatherIcon`, `classifyEatingMood`, `temperatureBand`, `weatherSeverity` — live in `packages/domain/src/weather/`)
  - Product forms (ProductForm — derivative-to-parent ingredient mappings, e.g. "lime juice" → parent canon "Lime" with a per-form yield; family-shared `productForms` collection, no per-user scoping, no soft-delete; `productForm` module owns `resolveProductForm`, `convertYield`, `createProductForm`, `confirmProductForm`, `updateProductForm`, the `decideProductFormProposal` arbitration query, and `aggregateParentCount` — computes the correct parent-ingredient buy-count across all recipes on the list by summing per-form demand within each form id before maxing across distinct forms, with a degrade path for legacy items written before `formDemand` existed)
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
  - Recipe hero image regeneration: `callRegenerateRecipeImage`
  - Recipe hero image upload: `callSetRecipeImageUpload`
  - Recipe scene brief (art-direction text for the hero image, author or revise on demand): `callDescribeRecipeScene`
  - Chat title generation: `callGenerateChatTitle`
  - Dev settings: `subscribeDevSettings`, `saveDevSettings`
  - App settings: `subscribeAppSettings`, `saveAppSettings`
  - AI model catalog: `callListAiModels`, `callTestModel`
  - Weather forecast: `subscribeWeatherForecast`, `callRefreshWeatherForecast`
  - Product forms: `subscribeProductForms`, `upsertProductForm`, `deleteProductForm`
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
- At init time, `environment` (`import.meta.env.MODE` — `'production' | 'staging' | 'development'`, registered under the OTel-standard `deployment.environment` super-property key) and `app_version` (the `__APP_VERSION__` build stamp, derived from the GitHub Release tag or `git describe`) are registered as PostHog super properties via `posthog.register()`. Super properties ride automatically on every subsequent event — autocapture, pageviews, manual captures, exceptions, and session replay metadata — so no per-call-site attachment is needed.
- Session replay: `maskAllInputs: true` (anything the user actively types, including the login email field, is always masked); on-screen rendered text is **not** masked — family-shared content is non-PII and needs to be legible for UX debugging. Replay is production-only (`import.meta.env.PROD`) and held back under `manualStart` for e2e/automated runs.

**Server subpath (`@salt/observability/server`)** — Node-only, bundled into `cloud-functions`:

- Wraps `posthog-node` for event capture and native OpenTelemetry (`@opentelemetry/api`) for spans. It does **not** own a tracer provider: `enableFirebaseTelemetry()` (Genkit-native) registers the single process-wide `NodeTracerProvider` and ships CF spans to GCP / Firebase Monitoring; these helpers operate on whatever provider is globally registered. The server adapter is a complete no-op when `POSTHOG_API_KEY` is absent (the `posthog-node` client is never built). When present, `environment` (resolved from the Firebase project id via `apps/cloud-functions/src/observability/environment.ts`, attached under the OTel-standard `deployment.environment` key) and `app_version` are recorded at init and merged into the properties of every capture from the two manual PostHog emit chokepoints (`captureServerEvent`, `captureServerException`), so CF events carry the same `deployment.environment`/`app_version` dimension vocabulary as browser events. AI generation traces are shipped separately via `attachAiOtlpSpanProcessor` (see below).
- Implements `MatchLoggingPort` for the CF side via `createPosthogServerMatchLoggingAdapter` (also exported as `createServerObservabilityMatchLoggingAdapter`), emitting the same slim `canon.match` event via `posthog-node`.
- Exposes two trace-context entrypoints so a Genkit flow runs within a W3C trace context (its span nests under the request trace instead of re-rooting), env-gated — see §8 / CLAUDE.md: `runWithExtractedTraceContext(headers, fn)` extracts the inbound W3C context from request **headers**, and `runWithSuppliedTraceContext(traceparent, fn)` installs the context carried by a SUPPLIED `traceparent` **string** (the field channel, issue #362 — used for both the browser→CF callable wire field AND the Firestore-trigger `traceContext` doc field, since neither carries inbound trace headers; the supplied helper synthesizes a `{ traceparent }` carrier and delegates to the same `propagation.extract` path, keeping one extraction implementation). Both degrade to a plain call when no usable context is present and never throw (Rule 10). `flushServerObservability()` drains queued events before a function returns.
- Exposes `setActiveSpanName(name)` to rename the currently-active OTel span from inside a Genkit flow body, appending a human-readable entity descriptor (e.g. the item name) so traces are scannable in the Genkit / Cloud trace view. No-op when no span is active; length-capped at 80 characters.
- Exposes `setActiveSpanAttributes(attributes)` to attach key/value attributes to the currently-active OTel span from inside a Genkit flow body — use to record a flow's inputs and decision so the trace is self-explaining in the trace viewer rather than just showing that the flow ran. Accepts `Record<string, string | number | boolean | undefined>`; `undefined` values are dropped so optional/nullable fields can be passed straight through without a cast at every call site. No-op when no span is active; never throws (Rule 10).
- Exposes `attachAiOtlpSpanProcessor(tracerProvider)` to install a span processor on the Genkit-owned OTel provider that remaps `genkit:*` spans to `gen_ai.*`/`ai.*` convention and POSTs them per-span to PostHog's AI OTLP endpoint (`/i/v0/ai/otel`). PostHog reconstructs the `$ai_trace → $ai_generation/$ai_embedding` tree with real model, tokens, cost, prompt, and completion; the real served model id is read from `genkit:output.custom.modelVersion` so PostHog can price cost accurately instead of using the unversioned `-latest` alias. Embeddings forward an 80-char input preview. Gated on `POSTHOG_API_KEY`; suppressed under `GENKIT_TELEMETRY_SERVER`; `SALT_AI_OTLP_LOCAL=1` opts back in for local verification. No new runtime dependency — uses structural OTel types only.
- `firebase-functions/logger` is used additively for top-level summary logs to Cloud Logging.

Both subpaths share a runtime-neutral schema mapper (`src/shared/matchOutcomeEvent.ts`, exporting `toCanonMatchEvent` / `CANON_MATCH_EVENT`) so the `canon.match` wire schema cannot drift between fast-path and CF emissions.

All three OTLP span-export legs (server AI `/i/v0/ai/otel`, server distributed `/i/v1/traces`, browser distributed `/i/v1/traces`) go through the shared `buildOtlpBody` (`src/shared/otlpWire.ts`), which stamps the environment ('production' | 'staging' | 'development') onto the span **resource** alongside `service.name` under the OTel-standard semantic-convention key **`deployment.environment`**. PostHog forwards any non-excluded resource attribute onto the resulting event as-is, so every span / `$ai_generation` carries the **same `deployment.environment` dimension** as events and logs. `deployment.environment` is the **single environment key across ALL telemetry** — spans, browser events, server events, and exceptions — so the app is OTel-standard and consistent (there is no parallel `environment` property). The value is computed identically per runtime — the server resolves it from the Firebase project id (`resolveServerEnvironment`) and reads it through a leaf state module (`src/server/serverEnvironment.ts`, kept separate so the span exporters can read it without an `init.ts` ↔ `otlpWire.ts` import cycle); the browser passes `import.meta.env.MODE` from `initObservability` down to `initBrowserTracing`. Omitted when unset, so un-environmented runs attach nothing (Rule 10).

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

**Principle: report the unexpected, suppress the expected.** The reason to report a _caught_ error is that the friendly-handling path would otherwise hide it — a handled failure never throws, so nothing automatic will surface it. Reporting exists to make those invisible failures visible; it is **not** a mirror of every `Failure`. The decision to report is gated on the **`DomainError` category** (§7.2), not on which call site happens to have a `catch` or an `onError` callback.

**Caught vs uncaught.** This gated port governs _caught_ errors only. _Uncaught_ errors — unhandled exceptions and promise rejections — are surfaced automatically by PostHog's exception autocapture as Error Tracking issues, independently of `ErrorReportingPort`. This is controlled by the PostHog **project-level** autocapture setting; the browser SDK init (`init.ts`) deliberately does not set `capture_exceptions`, so it neither forces nor blocks it. An uncaught error is unexpected by definition, so it is intentionally **not** subject to the category gate — there is nothing to suppress. Because caught errors are, by definition, caught, they never reach autocapture, so the two paths never double-report.

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

**Coverage.** Apply the policy uniformly across _all_ failure boundaries — command/write failures that return `Failure<DomainError>`, realtime read/stream `onError` callbacks, and server-side Cloud Functions — gated by category. Do not report at only the subset of sites that happen to expose an `onError` callback.

**Reported context.** Data is family-shared (no per-user PII by design), but raw user input (e.g. canon match text) must be scrubbed from reported error context. Report the error's type/message/stack and the `DomainError` category; do not attach free-form user content.

**Cloud Functions** continue to log via `firebase-functions/logger` with structured JSON shaped to match the `DomainError` taxonomy (`{ scope, docId, errorCategory }`). Server-side PostHog error reporting is **additive** to this logging, not a replacement.

**Enforcement.** Unlike the import-graph rules (§11), this policy is a runtime-categorization convention — it is enforced by code review, the category-gating helper at the `ErrorReportingPort` boundary, and unit tests, not by `eslint-plugin-boundaries`.

**Calibration.** For the post-rollout PostHog Error Tracking before/after check, the synthetic server person, and the known intentional client/server asymmetries, see [docs/error-reporting-calibration.md](error-reporting-calibration.md).

---

## 8. Cloud Functions requirements

Cloud Functions cover five categories of server-side work:

1. **Gen-AI callables** (`embedText`, `arbitrateCanon`, `matchOrCreateCanon`, `canonicaliseRecipeIngredients`, `parseRecipeIngredients`, `identifyEquipment`, `populateEquipmentEntry`, `regenerateCanonIcon`, `regenerateRecipeImage`, `describeRecipeScene`, `chefChat`, `authorRecipe`, `generateChatTitle`, `extractRecipeFromUrl`) — HTTPS callables invoked by the client. All carry `enforceAppCheck: false` (monitor-first rollout — unverified requests are allowed but reported to App Check metrics; flip the shared `APP_CHECK_ENFORCEMENT` constant in `index.ts` to `{ enforceAppCheck: true }` once staging metrics confirm legitimate traffic passes attestation). Notable variants:
   - **`chefChat`** — streaming `onCallGenkit` (120 s timeout, `isSignedIn()` auth); reads `equipmentManifest` and, when `recipeId` is set, the recipe document server-side; stateless (caller provides message history); plain-text streaming response via `gemini-pro-latest`.
   - **`authorRecipe`** — non-streaming `onCall` (120 s); converts a chat conversation to a complete `RecipeDoc` via a Flash + temperature:0 librarian flow, then batch-canonicalises all ingredients via `canonicaliseRecipeIngredientsFlow`. Uses `onCall` (not `onCallGenkit`) so the handler can wrap the batch-canonicalise flow in `reportFlowError`. Supports an optional `recipeId` on `AuthorRecipeInput`: when set, the flow reads the existing recipe from Firestore and grounds the librarian on the full recipe so it returns the COMPLETE updated recipe (edit mode) rather than authoring a near-empty recipe from an incremental chat (e.g. "add some cheese"). `assembleDraft` diffs the librarian output against the base recipe by `rawText`: unchanged ingredients carry over their existing canon match, parsed data, and id, skipping re-embedding; only new or edited ingredients go through parse + canon flows.
   - **`generateChatTitle`** — non-streaming `onCallGenkit` (15 s timeout, 0 retries); takes the first user message and assistant reply and returns a 2–5 word title string via Gemini Flash (temperature 0.3). Called in the background after the first exchange to replace the naive `text.slice(0, 60)` fallback with an AI-generated conversation title.
   - **`describeRecipeScene`** — non-streaming `onCall` (90 s timeout); reads the whole recipe — title, description, ingredients, and method steps — and returns a short art-direction brief (one prose paragraph, ~80 words) describing what the plated dish looks like and the mood/season/cuisine it reads as. Two modes: without `currentBrief`+`hint` it authors from scratch (the "start over" path); with both it REVISES the existing brief by folding the hint through the whole paragraph rather than appending it. Persists nothing — the brief returns to the client dialog for the user to read and edit; it only reaches Firestore when the user presses Regenerate, which stamps it as `imageBrief` via `callRegenerateRecipeImage`. Callable is signed-in only (no admin gate). Uses the `fast` model role.
   - **`extractRecipeFromUrl`** — non-streaming `onCallGenkit`; SSRF-guarded URL fetch (https-only, resolved-IP range checks, size/time/redirect caps) followed by JSON-LD structured-data extraction and an HTML→Gemini fallback. Returns a `RecipeDoc` draft with metric/British conversions applied. Failure codes are mapped to stable `HttpsError` gRPC codes so the client can show specific copy for each failure mode (`invalid-url`, `blocked-url`, `fetch-failed`, `not-a-recipe`, `ai-failed`).
2. **Admin-only callables** (`listAiModels`, `testModel`) — not Genkit flows; admin-gated `onCall` callables that proxy requests requiring the API key server-side so the key never reaches the browser.
   - **`listAiModels`** — fetches the live Gemini model catalog via `GET /v1beta/models`, classifies each model by role capability, and returns a filtered catalog per role. ~1h in-process cache; `forceRefresh` flag bypasses it. Used by the admin AI model settings page to populate the capability-filtered picker.
   - **`testModel`** — probes a single named model server-side and returns an `ok`/`error` outcome. Used by the admin Test button to verify availability before saving.
3. **Firestore write triggers** (`onShoppingListItemWrite`, `onCanonItemWritten`, `onRecipeWritten`) — respond to document writes and run domain logic server-side, writing results back to Firestore.
4. **Identity Platform blocking functions** (`beforeMemberCreated`) — reject account creation for any email not on the member allowlist; requires Identity Platform to be enabled on the target project.
5. **Data-fetch callables** (`refreshWeatherForecast`) — HTTPS callables that proxy external API calls server-side. `refreshWeatherForecast` reads the home location from `appSettings/singleton`, checks server-side staleness (skips when the cached forecast is <1h old and the location is unchanged), fetches Open-Meteo hourly data, aggregates the 16:00–19:00 evening window per day using the domain's `aggregateForecastWindow`, and writes the result to `weatherForecast/singleton`.
6. **Storage-write callables** (`setRecipeImageUpload`) — HTTPS callables that write to Firebase Storage via the Admin SDK without invoking AI. `setRecipeImageUpload` accepts a user-supplied base64-encoded image (already cropped to 3:2 by the client's `ImageCropper` primitive), re-encodes it through the same `encodeHeroImage` pipeline used by the AI path (bounded 1280², WebP q80), overwrites the stable `recipe-images/{id}.webp` Storage object, and stamps `recipe.image = { url, source: 'upload' }` via a partial Firestore update, bumping `imageRequestedAt` as a cache-buster nonce. `storage.rules` stay write-locked — the client never writes Storage directly. The `source: 'upload'` marker ensures `onRecipeWritten.imageNeedsGeneration` returns false immediately so a manually-uploaded photo is never overwritten by the AI trigger.

All categories are intentionally minimal. All functions run with a **512 MiB memory floor** set via `setGlobalOptions({ memory: '512MiB' })` — the 256 MiB default sits below this codebase's resting footprint (firebase-admin + Genkit/OTel + posthog-node all load at module init). Functions defined before `setGlobalOptions` evaluates (`onShoppingListItemWrite`, `regenerateCanonIcon`, `beforeMemberCreated`) pin 512 MiB inline; `onCanonItemWritten` overrides upward to 1 GiB for icon decode.

**Admin-managed AI model selection.** Every AI flow resolves its model at call time via `resolveModel(role, flowId?)` rather than using a hardcoded literal. Model names are stored in the `appSettings/singleton` Firestore document, cached for 180 s per CF instance; every role field falls back to the current production model literal when the doc is missing, corrupt, or never configured — AI never breaks on a bad settings doc. Flows are bucketed into five roles: `fast` (accuracy-first: `authorRecipe`, `extractRecipeFromUrl`, `identifyEquipment`, `describeRecipeScene`), `lite` (cost/latency-optimised: `arbitrateCanon`, `parseRecipeIngredients`, `parseEntry`, `generateChatTitle`, `populateEquipmentEntry`), `pro` (quality-first: `chefChat`), `embedding` (`embedText`, `serverEmbedding`), and `image` (`generateCanonIcon`, `generateRecipeImage`). An optional `perFlow` override map in the settings doc lets a single flow diverge from its role without changing the whole tier. `AI_FLOW_ROLES` in `@salt/domain/schemas` is the canonical flow→role mapping; renaming a key there orphans any saved per-flow override.

Cloud Functions:

- Import domain + observability/server (never the default `observability` subpath, which wraps the browser-only PostHog SDK `posthog-js` and cannot run in Node)
- Talk to Firestore directly via `firebase-admin` — do not import `@salt/firebase-sync`, which wraps the browser SDK
- Never import UI
- Never contain business logic
- Only orchestrate: input validation (via Zod schemas from `@salt/domain/schemas`; callable entry points throw `HttpsError('invalid-argument')` on parse failure), domain commands/queries, gen‑AI providers, and returning results
- Must be stateless
- Callables must be testable without Firebase emulators (via domain mocks); triggers use the Firestore emulator for write-back integration tests

**Trace propagation model (browser→CF continuity, issue #362).** Each CF invocation should render as one coherent trace: the Genkit flow span nests under the request trace instead of re-rooting. The canon-matching callables (`matchOrCreateCanon`, `canonicaliseRecipeIngredients`, `extractRecipeFromUrl`, `authorRecipe`) and the two equipment-add callables (`identifyEquipment`, `populateEquipmentEntry`) install a W3C trace context before the flow runs. These are **user-initiated** callables, so the **browser-supplied field is preferred**; the context comes from one of two sources in fixed precedence:

1. A browser-**supplied** `traceparent` carried as a NAMED, TYPED, OPTIONAL field on the callable WIRE input → `runWithSuppliedTraceContext`. Preferred when present.
2. Else the **inbound W3C trace _header_** off `request.rawRequest.headers` (what the platform/GCP injects) → `runWithExtractedTraceContext`.

The field is the preferred channel because **the Firebase JS callable SDK cannot carry a custom per-call HTTP header** — `HttpsCallableOptions` is only `{ timeout?, limitedUseAppCheckTokens? }` and the `@firebase/functions` transport sets its own fixed headers (Content-Type, Authorization, App Check, Instance-ID) with no injection hook — so the field is the ONLY channel that can carry the browser's trace id, and thus the only one that actually unifies the browser action with the server flow. The inbound header is GCP's FRESH request-trace root, so preferring it would re-root away from the browser trace and could never unify with it; it is the fallback only when no non-empty field is present. The field is validated by a wire-envelope schema in `@salt/domain/schemas` (`<Name>WireInputSchema = <Name>InputSchema.extend({ traceparent: z.string().optional() })`) and **stripped at the entrypoint** so the domain flow receives the PURE domain input (domain purity — flows never consume `traceparent`). `firebase-sync` callable wrappers take an optional `traceparent?: string` argument and forward it on the payload; they only forward the string and never import observability (Rule 4). The field is additive + optional, so old clients that omit it stay backward-compatible.

A malformed/absent `traceparent` must NOT fail the call — it is best-effort (Rule 10); only a malformed wire envelope (bad domain input) is rejected with `HttpsError('invalid-argument')`. The whole mechanism is env-gated: SUPPRESSED when `GENKIT_TELEMETRY_SERVER` is set (local `pnpm dev:emulators`) so flows stay root-listed in the Genkit Dev UI. This SUPERSEDES the prior deferred-unification / no-`_trace`-field stance: the new field is named + typed + schema-validated (NOT the magic `_trace`). The browser supplies a REAL trace id via its in-memory OTel tracer (`startUserActionSpan`, `browserTracer.ts`), which roots the user-action span client-side and exports it to PostHog's `/i/v1/traces` endpoint.

**Grouping multi-call user actions (issue #361).** The equipment-add action is the cross-invocation case: it fires `identifyEquipment` (raw name → candidates), the user picks one (human think-time), then `populateEquipmentEntry` (confirmed name → accessories) — two separate callables that should read as ONE logical flow. The capture page (`EquipmentCapturePage.svelte`) mints a single `startUserActionSpan('Add equipment: <name>')` at the first step, holds it across the think-time, and hands its SAME `traceparent` to BOTH calls (each wrapped in a `.child(...)` span for the round-trip), then ends it on save / cancel / unmount. Because both flows install that one supplied context, they nest under a single trace instead of re-rooting two. This required converting the equipment callables `onCallGenkit`→`onCall` (so the supplied context is installed before Genkit opens the flow span); like the other `onCall` flows they now flush the AI-OTLP spans in a `finally` (`onCall` has no framework forceFlush) and report failures at the entrypoint catch. The descriptive trace name comes from the browser root span, so no `setActiveSpanName`/remap change is needed for it.

**Trigger continuity via a Firestore correlation field (issue #362, Phase 5 — implemented).** Firestore triggers have no inbound HTTP headers, so they continue a browser-rooted trace through an OPTIONAL, additive `traceContext` field (a W3C `traceparent` string) on the written doc — `ShoppingListItemSchema` and `CanonItemSchema` each carry `traceContext: z.string().optional()`. The flow:

1. The browser roots `startUserActionSpan('Add item: <name>')` at "add to shopping list" and threads its `.traceparent` into `saveShoppingListItem(item, traceparent?)`, which stamps it onto the item doc as `traceContext`. `firebase-sync` only forwards the plain string and never imports `@salt/observability` (Rule 4).
2. `onShoppingListItemWrite` reads `traceContext` off the item and runs the canon-matching work within it via `runWithSuppliedTraceContext` (so the `shoppingList.matchItem` span + its Firestore children nest under the browser action). It also threads `traceContext` into `buildMatchOrCreatePorts`/`createFirestoreCanonStore`, so the canon write-back stamps `traceContext` on the canon doc. CRITICAL — the ADAPTER adds the field at write time (`.set({ ...item, ...(traceContext ? { traceContext } : {}) })`); the pure-domain `CanonItem` never carries it (domain purity).
3. `onCanonItemWritten` reads `traceContext` off the canon doc and runs the icon + embedding work within it, so the Genkit/image spans nest under the same trace.

Both triggers first await a CF-local telemetry-readiness gate (`whenCfTelemetryReady()`, armed by `index.ts` with the `enableFirebaseTelemetry()` boot promise) before calling `runTriggerWithTraceContext` — a cold-start trigger fires before the OTel propagator + async-hooks context manager are live, and without the gate `propagation.extract` hits the no-op propagator and silently drops the supplied trace. The gate is bounded (10 s) and degrades to a normal root trace on timeout (Rule 10); it resolves immediately in unit tests and on warm instances. Result: "Add 'tinned tomatoes' to shopping list" is ONE trace — browser action → canon-match trigger → icon trigger. Env-gated identically to the callable path (a CF-local `runTriggerWithTraceContext` wraps `runWithSuppliedTraceContext` with the same caller-side gate): SUPPRESSED under `GENKIT_TELEMETRY_SERVER` (local `pnpm dev:emulators`) so flows stay root-listed in the Genkit Dev UI. `traceContext` is TRANSPORT ONLY (domain never branches on it); a missing/malformed value degrades to a normal root trace and never fails a write or trigger (Rule 10). Additive/back-compat — old docs lack it and stay valid. The bare `traceContext`-only canon write-back cannot loop the icon/embedding triggers: their idempotency guards key off `thumbnail`/`iconRequestedAt`/`embedding`, never `traceContext`.

---

## 9. PWA (UI) requirements

The PWA:

- Imports domain, firebase-sync, observability, ui-components, shared-types
- Never imports Firebase SDK, IndexedDB, or PostHog SDK directly
- Never contains business logic (including conflict resolution policy)
- Uses domain commands/queries as its API
- Wires `AuthProvider`, `ErrorReportingPort`, `MatchLoggingPort`, `EmbeddingPort`, and `CanonArbitrationPort` at composition time
- Starts `initCanonSync()`, `initMealPlanSync()`, `initChatSync(uid)`, `initDevSettingsSync()`, `initAppSettingsSync()`, and `initWeatherSync()` from `App.svelte` when the user authenticates — subscriptions begin once at auth time, not on individual page mounts
- In-memory Svelte stores (`canonItems`, `aisles`, `aisleUsage`) are the UI's read layer; `upsertCanonItem` and `saveAisles` are the write path
- **Recipes** (`/recipes`, `/recipes/new`, `/recipes/:id/edit`, `/recipes/:id`): family-shared recipe store. Available to all members — the nav entry is in the default nav and the route pages have no `AdminGuard` wrappers. `recipeService` drives the pages; `subscribeRecipes` / `loadRecipe` / `saveRecipe` / `deleteRecipe` are the firebase-sync data operations. Ingredient parsing and canonicalisation are on-demand: the editor surfaces a per-row **Match** button and a batch **Canonicalise** button that call `parseRecipeIngredients` and `canonicaliseRecipeIngredients` respectively. The recipe list is **image-forward**: recipes display a hero thumbnail generated by the `onRecipeWritten` Firestore trigger on create; the list supports text search, sort (by date or name), and tag filters. The recipe list page exposes an **Import from URL** action: the user pastes a URL, `importRecipeFromUrl` (in `recipeService`) calls `callExtractRecipeFromUrl`, the extracted draft (with metric/British conversions already applied) is stashed, and the user is routed to `/recipes/new` with the editor pre-filled. The edit page exposes a searchable **Makes** picker (over the canon store, matching name + synonyms) to link the recipe to the grocery item it produces — stored as `producesCanonId: string | null` on the recipe (`z.string().nullable().default(null)`, back-compat on production reads). Recipe-to-shopping-list extraction opens a review sheet (`RecipeAddToListSheet`) where each ingredient row shows Add/Check toggles driven by `recipeItemAddDefault` (canon `shoppingBehavior` → add/check/skip defaults), plus a **Buy/Make** toggle for rows whose matched `canonId` is linked to another recipe's `producesCanonId` (resolved by the pure domain `findProducingRecipes`). Choosing Make fans out the producer recipe's own ingredients as individually-toggleable sub-entries scaled to the chosen batch servings (`buildMadeSubRows` → `buildRecipeAddPlan`); sub-rows carry no nested Buy/Make affordance (one level deep). Confirmed items land on the list, with "check" rows flagged `needsCheck` for a quick confirm/drop affordance on the shopping screen. `buildRecipeAddPlan` evaluates each ingredient's live match via `hasLiveCanonMatch` so dangling canon references are added as raw text rather than carrying stale `canonId`s. It also maps `parsed.item` (the clean, pre-canon ingredient name) to the shopping item's `rawText`, with `parsed.notes` forwarded to the item's `notes` field; falls back to the full raw ingredient line for unparsed ingredients or when the parse yields an empty item. Cleaner `rawText` values also improve server-side canon matching for unmatched rows. The recipe view page (`/recipes/:id`) shows the AI-generated hero image (produced by the `onRecipeWritten` trigger on create) with overlaid hero controls: **Regenerate** and **Upload/Paste**. **Regenerate** opens a dialog pre-filled with the recipe's saved `imageBrief` (the art-direction paragraph that directed the current image), editable as plain text. The user can edit the brief directly, apply a short hint via a "Steer" action that calls `callDescribeRecipeScene` to revise the brief (folding the hint through the whole paragraph so it reads as one coherent brief, not an appended contradiction; the revision lands back in the box still editable), or press "Start over" to call `callDescribeRecipeScene` without a current brief — which authors a fresh brief from the whole recipe and discards accumulated edits. Regenerate is disabled mid-revision. Pressing Regenerate submits the (possibly edited) brief and calls `callRegenerateRecipeImage(recipeId, brief?)`, which writes `brief` as `imageBrief` on the recipe doc (clearing it if the box is empty, which routes the trigger back to "author one") and clears `image` + stamps `imageRequestedAt` to re-fire `onRecipeWritten`. The trigger reads `imageBrief` verbatim when present; when absent it calls `describeRecipeSceneFlow` to author one before generating the image. `imageHidden` is retained in the schema for back-compat but is now inert — hero visibility is determined solely by whether an image URL exists. **Upload/Paste** (calls `callSetRecipeImageUpload` — the user picks a local file or pastes from the clipboard, crops it to 3:2 via the `ImageCropper` primitive, and the CF re-encodes and writes it to Storage with `source: 'upload'`; a manually-uploaded photo is never overwritten by the AI trigger). The page uses a two-column desktop layout: the recipe body on the left, an embedded chef chat sidebar on the right. The sidebar creates (or resumes) an owner-scoped chat session with `recipeId` set without navigating away; an **Update recipe** button in the sidebar re-runs the `authorRecipe` librarian flow against the sidebar conversation, then gates the result behind a **RecipeChangeSummary** diff preview (a `diffRecipe`-powered section-grouped summary of added/removed/changed ingredients, steps, and metadata fields) before the LWW write lands — the user can Apply or Discard.
- **Chat / AI Kitchen Assistant** (`/chat`, `/chat/:id`): per-user AI cooking assistant, accessible to all members (ChefHat nav entry, no `AdminGuard`). `chatService` drives the pages; `initChatSync(uid)` starts the owner-scoped `subscribeChatSessions` subscription at auth time. Chat list page: session list, new-chat action, per-session delete with confirm dialog. Chat session page: message bubbles with streaming partial render (▌ cursor), auto-resizing Enter-to-send textarea fixed above the bottom nav, scroll-to-bottom effect. After the first exchange, `generateChatTitle` is called in the background to replace the naive truncated-text title with a 2–5 word AI-generated title. Free-standing sessions show a **Save as recipe** button (visible once the assistant has replied); recipe-attached sessions (accessed from the recipe view sidebar) show a **View recipe** link and an **Apply changes** button that re-runs the `authorRecipe` librarian flow, then gates the result behind the shared **RecipeChangeSummary** diff preview before the LWW write lands.
- **Meal plan** (`/mealplan`): the weekly evening-meal planner, accessible to all members. Shows a seven-day week-at-a-glance grid with prev/next/this-week navigation and a Load-template button. Each collapsed day row shows a meal note, attached recipe titles, cooks, and an attendee count alongside an evening weather glyph. Expanding a day reveals a three-block layout: a forecast strip at the top, a Dinner block (meal note + attached recipes with hero thumbnails and navigation to the recipe view page; an **Add to shop** action per recipe opens the same `RecipeAddToListSheet` used on the recipe page), then an At-the-table roster. Recipes are attached via a picker that searches the recipe store; titles and thumbnails resolve live from the recipes store — no denormalisation. `setWeekDayRecipes` (via the `setDayRecipes` domain command) is the write path; `ensureFreshForecast()` is called on mount to trigger a server-side Open-Meteo refresh when the cached forecast is stale or missing. `mealPlanService` drives the page; subscriptions are started at auth time via `initMealPlanSync()`.
- **Admin operator area** (`/admin` route group): `AdminGuard` redirects non-admins; the Members CRUD screen (`/admin/members`) lets admins add, edit, and remove allowlist members; `membersService` exposes a sorted roster store backed by `subscribeMembers`. Canon management (`/admin/canon`, `/admin/canon/new`, `/admin/canon/aisles`, `/admin/canon/:id`) is also gated here — canon stewardship is an operator function, not an everyday user activity, so the list, create, detail, and aisle management pages all sit under `AdminGuard`. The `needs_approval` count badge is surfaced on the Admin nav entry so operators can see the review queue from anywhere in the app. Product forms management (`/admin/product-forms`, `/admin/product-forms/new`, `/admin/product-forms/:id`) is similarly gated — operators review AI-proposed derivative-to-parent mappings (flagged `needs_approval`) and can create or edit forms manually; a pending-count badge on the Admin nav and the Product Forms tile surfaces the review queue. Meal plan template administration (`/admin/mealplan`) lets operators edit the standard weekday-keyed template and the `firstDayOfWeek` setting; gated by `AdminGuard` (cosmetic — Firestore rules allow any authenticated member to write meal plan documents). Development settings (`/admin/dev-settings`) exposes per-environment operator switches — currently the canon-icon AI generation kill-switch (`canonIconGenerationEnabled`) and the recipe hero-image generation kill-switch (`recipeImageGenerationEnabled`; toggles independently of the canon-icon switch so the two AI image tiers can be stopped separately); write is admin-only enforced by Firestore rules (not cosmetic); `devSettingsService` drives the page and defaults to enabled until the doc loads, mirroring the CF fail-open behaviour. AI model settings and home location (`/admin/app-settings`) lets admins view and edit the Gemini model used for each AI role (`fast`, `lite`, `pro`, `embedding`, `image`), set optional per-flow overrides, and configure the home location used for evening weather forecasts on the meal planner (geocoded via `geocodingService.ts`, stored in `appSettings/singleton`); backed by `appSettingsService` which reads/writes the `appSettings/singleton` doc via `subscribeAppSettings` / `saveAppSettings`; the model picker is populated server-side by `callListAiModels` (no API key in browser), and a Test probe calls `callTestModel` to verify availability before saving; gated by `AdminGuard`. Client-side gating is cosmetic — real enforcement is in Firestore rules and the `beforeMemberCreated` blocking function.
- Offline data is provided by Firestore's `persistentLocalCache`. The service worker never caches Firestore traffic or any app data.
- **PWA installability (Tier-1):** A Workbox-generated service worker (`vite-plugin-pwa`, `generateSW` strategy) precaches the built app shell and static assets only. The service worker is the sole consumer of the Cache API; no other module may touch `caches` directly (CLAUDE.md hard rule #3). The SW is disabled in dev (no interference with HMR). Manifest identity is env-distinct: `VITE_PWA_NAME`, `VITE_PWA_SHORT_NAME`, and `VITE_PWA_THEME_COLOR` are read at build time from `.env.<mode>` so staging and production install as distinct apps. The auto-update flow (owned by `src/lib/pwa.ts`) defers page reloads to safe moments (hash route change or tab refocus) and never reloads mid-interaction. A separate stale-deploy recovery flow (`setupPreloadErrorReload`, wired from `main.ts`) handles lazy-route chunk 404s that arise when a deploy replaces hashed chunk files while a tab is still open: on the first `vite:preloadError` event it silently reloads once onto the fresh build, guarded by a one-shot `sessionStorage` key (`salt:pwa:preloadReloadGuard`) that prevents a reload loop; if the chunk still fails after that reload, the `lazy()` route wrapper in `routes/lazyRoute.ts` resolves to an inline `RouteLoadFailed.svelte` fallback (retry button) instead of hanging, and reports the failure as a `StorageError` via `errorReporting.ts`. The guard clears on successful boot via `clearPreloadReloadGuard()` in `main.ts`. Prod-only, mirroring the service worker's dev gate.

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
- Forbid Firebase SDK imports (`firebase` / `firebase-admin`) in `domain`, `observability`, and `ui-components`. The browser `firebase` SDK lives in `firebase-sync`; `firebase-admin` is used directly in `cloud-functions` (§3, §8) and is **not** restricted there.
- Forbid IndexedDB / browser-storage package imports (`idb`, `idb-keyval`, `dexie`) in `domain`, `firebase-sync`, `observability`, and `ui-components`. This rule is **not** applied to the apps (`web-pwa`, `cloud-functions`) or `testing-utils` — the "no browser storage" contract (Rule 3) holds there by convention and review, not by lint.
- Forbid PostHog SDK imports (`posthog-js` / `posthog-node`) outside `observability`: every non-observability package (`shared-types`, `domain`, `firebase-sync`, `ui-components`, `testing-utils`) and both apps go through the `@salt/observability` ports, never the SDK directly.
- Forbid the wrong `observability` subpath per runtime: the default (browser `posthog-js`) subpath in cloud-functions, and the `observability/server` (`posthog-node`) subpath in web-pwa.
- Forbid firebase-sync ↔ observability imports (sibling adapters must not import each other)
- Forbid domain importing anything except shared-types — also blocks Node built-in imports (`no-restricted-imports`) and browser / `process` globals (`no-restricted-globals`), so domain purity re Node/browser is lint-enforced (issue #413)
- Forbid UI importing Cloud Functions
- Enforce strict TypeScript rules

### dependency-cruiser

`pnpm depcruise` cruises the real `packages` + `apps` tree and enforces the resolved-path rules ESLint's specifier-based checks can't see. It runs in the pre-commit hook **and** as a dedicated CI step (issue #413), so it is not bypassable via `--no-verify` or a bot / web-UI commit:

- Forbid **circular dependencies** (`no-circular`) — this is a dependency-cruiser rule, not an ESLint one
- Re-enforce the Firebase / IndexedDB / PostHog (`no-posthog-outside-observability`) / adapter-cross-import / `domain-only-shared-types` / observability-subpath rules over resolved paths
- Forbid importing `web-pwa` from anywhere (`no-import-web-pwa`) and packages importing apps (`packages-no-import-apps`)

### tsconfig

- Use project references to enforce module boundaries
- Each module has its own tsconfig
- Root tsconfig defines the dependency graph

### Commit gateway

Every commit must:

- Pass linting
- Pass type checks
- Pass Svelte template checks (`pnpm check` — `svelte-check` across `@salt/ui-components` and `@salt/web-pwa`)
- Pass dependency graph checks
- Pass unit tests
- Pass formatting
- Reject any Firebase SDK import in `domain` / `observability` / `ui-components` (browser SDK lives in `firebase-sync`; `firebase-admin` is allowed in `cloud-functions`)
- Reject any IndexedDB import in `domain` and the adapter/UI packages (`firebase-sync`, `observability`, `ui-components`)
- Reject any PostHog SDK import (`posthog-js` / `posthog-node`) outside `observability`
- Reject the wrong `observability` subpath per runtime (web-pwa → default, cloud-functions → `/server`)
- Reject any UI → backend leakage
- Reject any domain impurity (Firebase / Node-built-in imports, browser / `process` globals)

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
