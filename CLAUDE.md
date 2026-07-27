# Salt 2.0 — Architecture Contract for AI Agents

This file is the authoritative, machine-enforced architecture contract. Violating these rules will cause CI to fail. The full prose contract lives in [docs/salt-architecture.md](docs/salt-architecture.md).

## Layer map

```
shared-types               →  (nothing)
domain                     →  shared-types
firebase-sync              →  domain, shared-types          # Firebase SDKs only; Firestore is the live data layer
observability              →  domain, shared-types          # PostHog browser SDK (posthog-js); default subpath, for web-pwa
observability/server       →  domain, shared-types          # posthog-node + native OTel; ships CF spans/events server-side, exposes a span-processor registration hook for CF-local concerns
ui-components              →  (external only — shadcn/tailwind)
testing-utils              →  shared-types, domain, firebase-sync
web-pwa                    →  shared-types, domain, firebase-sync, observability, ui-components
cloud-functions            →  shared-types, domain, observability/server
storybook                  →  ui-components                 # dev-only Storybook; typecheck+check in CI, no build/e2e (see apps/storybook/README.md)
```

`firebase-sync` and `observability` are **siblings** — they must not import each other. `@salt/observability` ships two subpath entrypoints from a single package: the default subpath wraps the PostHog browser SDK (`posthog-js`) and is for `web-pwa`; `@salt/observability/server` wraps `posthog-node` + native OpenTelemetry and is for `cloud-functions`. The two subpaths share a runtime-neutral schema mapper (`src/shared/`) so the `canon.match` wire schema cannot drift between fast-path and CF emissions. Cross-runtime imports are forbidden: `web-pwa` must not import `/server`, and `cloud-functions` must not import the default subpath.

## Hard rules

1. **Domain is pure.** `packages/domain` must not import Firebase, Node.js built-ins, browser APIs, or any I/O. No side effects. Pure functions and types only. Any conflict-resolution policy belongs here (never in an adapter) — but none is wired in today: document-level LWW is enforced entirely by Firestore (see data-model conventions).
2. **Firebase SDKs are split by runtime.** The browser `firebase` SDK is imported only in `packages/adapters/firebase-sync` (it wraps the browser SDK for the PWA + offline cache). Cloud Functions talk to Firestore directly via `firebase-admin`/`firebase-functions` — the Admin SDK belongs in `apps/cloud-functions` (~25 files) and is **not** a violation there. What the lint/depcruise rules actually forbid is **any** Firebase SDK (`firebase` or `firebase-admin`) in `domain`, `observability`, and `ui-components`. `firebase-sync` is browser-only and must never be imported by `cloud-functions` (see §8).
3. **No IndexedDB / browser storage.** No package may import `idb`, `idb-keyval`, or touch `window.indexedDB` / `localStorage` / `sessionStorage` / `caches` directly. Offline reads and writes are handled by Firestore's `persistentLocalCache`. **Narrow exceptions (both scoped to `apps/web-pwa` only, both must degrade gracefully if storage throws, and both explicitly exclude all adapters):** (a) `window.localStorage` for pre-authentication ephemeral state that has no Firestore-backed alternative — specifically the two sign-in keys in `apps/web-pwa/src/lib/auth.svelte.ts`, both of which must persist before any user is signed in and both of which must survive the user leaving the app to read their email: the magic-link pending email `salt:auth:pendingEmail` (email clients open the link in a fresh tab/window, so `sessionStorage` is unavailable) and the in-flight OTP step `salt:auth:pendingOtp` (`{ email, sentAt }`, TTL-checked against the server's 10-minute code expiry on read; an installed iOS PWA is routinely killed while backgrounded, and a fresh launch gets a fresh `sessionStorage`, so an in-memory step would strand the user on the request page holding a code); and (b) `window.sessionStorage` for the one-shot stale-deploy reload guard in `apps/web-pwa/src/lib/pwa.ts` (`salt:pwa:preloadReloadGuard`), which must survive a single page reload within the same tab to prevent a chunk-load reload loop and auto-clears at session end (page-load mechanics, not user data — no Firestore-backed alternative). Everything else stays forbidden.
4. **Adapters do not import each other.** `firebase-sync` ↔ `observability` is forbidden in both directions.
5. **Cloud Functions do not import the default `@salt/observability` subpath.** That subpath wraps the browser-only PostHog SDK (`posthog-js`) and cannot run in Node. Server-side observability uses `@salt/observability/server` (`posthog-node` + native OpenTelemetry). `firebase-functions/logger` continues to be used additively for CF-side match logs.
6. **No importing apps.** Nothing may import `@salt/web-pwa`, `@salt/cloud-functions`, or `@salt/storybook`.
7. **UI primitives go through `@salt/ui-components`.** `apps/web-pwa` must never import `shadcn-svelte`, `bits-ui`, or `melt-ui` directly — always through `@salt/ui-components`.
8. **No circular dependencies.** Enforced by dependency-cruiser.
9. **`shared-types` imports nothing from `@salt/*`.** It may only depend on external packages or nothing.
10. **Adapters never throw for operational errors.** All failures cross the boundary as `Failure<DomainError>` or `Conflict<T>` (see [docs/salt-architecture.md §7](docs/salt-architecture.md)).
11. **PostHog SDK only in `observability`.** `posthog-js` and `posthog-node` may be imported only in `packages/adapters/observability`, which wraps them behind the `ErrorReporting`/`MatchLogging` ports. Every other package and both apps depend on the `@salt/observability` ports (default subpath in `web-pwa`, `/server` in `cloud-functions`) — never the SDK directly. Enforced by `no-restricted-imports` in every non-observability layer and by depcruise's `no-posthog-outside-observability`.

## Data model conventions

- **All data is family-shared.** No `userId`, `householdId`, or per-user scoping on any collection. Equipment, recipes, shopping list, canon, aisles, and meal planner all live in single shared collections. Do not add user-scoped fields to new collections.
- **Per-user exceptions (only three).** `chatSessions`, `cookSessions`, and — third — `pushSubscriptions` are the only owner-scoped collections, deliberate exceptions to the family-shared rule because a chat history / an in-progress cook / which device to notify is personal. `pushSubscriptions` (issue #544) holds one web-push subscription per device, id `${uid}_${deviceHash}`, `ownerUid` set on create and pinned on update, read/delete gated on `resource.data.ownerUid` with a `resource == null` clause (deterministic id → subscribe/delete-before-exists, mirroring `cookSessions`). Cloud Functions read every subscription via the Admin SDK (bypassing rules) to send. There is also a server-owned, client-denied `timerDeliveries` ledger (exactly-once delivery dedupe) — a separate doc, never a write-back onto `cookSessions`. `cookSessions` uses a deterministic id (`${recipeId}_${uid}`) with `ownerUid == request.auth.uid` set on create and pinned on update; unlike `chatSessions` it has **no TTL** (a cook may span several days) and its orphan cleanup (deleted-recipe → delete session) is client-side only. Its read/delete rule also permits `resource == null` (issue #558) — the deterministic id means the cook page subscribes before the session exists, and a rule dereferencing `resource.data` on an absent doc is denied and kills the listener for good. Do not "tidy" that clause away; it is covered by both emulator suites. (`pushSubscriptions` mirrors this same `resource == null` clause for the same deterministic-id reason.)
- **No soft-delete, no tombstones.** Firestore is the master; delete means delete. Canon has a vestigial `deletedAt` field from the local-first era — do not copy this pattern to new schemas.
- **LWW per document.** Last-write-wins at the document level, enforced entirely by Firestore's full-document `setDoc` — no merge logic at any layer. There is no live conflict-resolution policy today; if a document ever needs bespoke resolution it belongs in `packages/domain` (pure), never in an adapter. Note the granularity: a client `setDoc` rewrites the whole doc, so it can clobber a field a CF trigger wrote concurrently (e.g. `thumbnail`/`embedding`) — that is the LWW contract, not a bug. See the LWW integration test in `firebase-sync`.

## AI / Genkit conventions

- **All AI access via Genkit callables.** Every Gemini call goes through a Genkit flow invoked as a Firebase callable Cloud Function. No AI API keys in the client.
- **Wrap every AI call in `withAiTimeout`.** Bare Genkit flow calls have no built-in timeout and will hang the function for the full 60 s quota on a slow or hung model response. This applies to callable flows and Firestore triggers alike. Functions calling AI must also declare their AI-related secrets.
- **Server-side trace propagation is env-gated.** Callables carry the browser's `traceparent` on a named, typed, optional wire field (stripped at the entrypoint so domain flows stay pure); Firestore triggers carry it as an additive `traceContext` field on the written doc. Both degrade to a plain root trace and never throw (Rule 10), and both are suppressed under `GENKIT_TELEMETRY_SERVER`. **Full contract — precedence, the six affected callables, the trigger chain, and the reasoning behind each choice — is in [apps/cloud-functions/CLAUDE.md](apps/cloud-functions/CLAUDE.md)**, which loads automatically when working in that app. Read it before touching callable entrypoints, trigger trace plumbing, or `@salt/observability/server`.

## Workflow

- **Issue-first for substantial changes.** New packages, new dependencies, layer-map edits, and cross-package refactors require a GitHub issue and explicit go-ahead before implementation. Design Q&A in chat is not a greenlight.
- **Production data back-compat.** Canon, Aisles, Equipment, Shopping List, Meal Planner, and Recipes collections hold real production data — schema changes must be backward-compatible on read, or require a one-off migration. (Recipes lost their greenfield status when the module shipped to all members in #240, 2026-06-17; treat recipe schema changes like any other production collection from here on.) See also: Zod schema conventions below.

## Zod schema conventions

- **Schemas live in `@salt/domain/schemas`.** All zod schemas are defined under `packages/domain/src/schemas/` and exported via the `@salt/domain/schemas` subpath. Do not define schemas in adapters, apps, or `@salt/shared-types`.
- **Schema-first.** Define the zod schema first; derive the TypeScript type with `type Foo = z.infer<typeof FooSchema>`. Never maintain a hand-written type alongside a schema for the same shape.
- **Validate at trust boundaries only.** Add `.parse()` or `.safeParse()` at: AI/Genkit flow outputs, Firestore document reads (in `firebase-sync`), callable CF inputs, and "type laundering" sites (`as` casts, `unknown` narrowings, `JSON.parse`, string → structured parsers). Do **not** add validation to internal domain → domain calls, adapter internals, or any code the TypeScript compiler already proves correct.
- **Handle validation failures per boundary type.** Always use `.safeParse()`, then:
  - **Adapter single-document reads** (e.g. `load(id)`) → return `Failure<DomainError>` (`{ kind: 'StorageError', reason: 'corruption' }`); do not throw across internal layer seams.
  - **Adapter list reads & realtime subscriptions** → skip the invalid doc, log it, and return the valid subset; one corrupt doc must not fail the whole read. Stream-level errors still surface via `onError`.
  - **Callable CF entrypoints** → `throw new HttpsError('invalid-argument', …)`; this is the Firebase callable protocol for rejecting bad client input, not an internal seam.
  - **Firestore triggers** → log and return; there is no caller to surface a `Failure` to.
- **Production schema changes need a back-compat check.** Pre-launch (greenfield) schema-shape changes are free. Once production holds real data, a schema-shape change must not break documents already written — keep it backward-compatible on read or run a one-off migration. See [docs/salt-architecture.md §1.1](docs/salt-architecture.md).

## Observability / error-reporting conventions

- **Report the unexpected, suppress the expected.** Caught errors reach PostHog error tracking only via `ErrorReportingPort`, gated on the `DomainError` category — not by which call site happens to have a `catch`/`onError`. Reporting exists to surface failures the friendly-message path would otherwise hide; it is not a mirror of every `Failure`. Full policy: [docs/salt-architecture.md §7.6](docs/salt-architecture.md).
- **Report:** `StorageError`, `SyncError`, uncategorised/unknown errors, and (server-side) unhandled CF exceptions + AI/Genkit flow failures. `AuthError` is reported **except** the sign-out / token-refresh `permission-denied` race on in-flight listeners.
- **Do not report:** `NetworkError`/offline, `ValidationError`, `NotFound`, `ConflictError`, and the sign-out auth race.
- **Coverage is uniform** across write/command failures, realtime `onError`, and server CF — gated by category, not by call-site shape.
- **Best-effort, never throws** (Rule 10). Scrub raw user input (e.g. canon match text) from reported context — data is family-shared, but free-form user content must not be attached. Server PostHog reporting is additive to `firebase-functions/logger`.
- **Not lint-enforceable.** This is a runtime convention checked by review + the gating helper + unit tests, not `eslint-plugin-boundaries`.

## Enforcement

- `pnpm lint` — ESLint with `eslint-plugin-boundaries` checks the import graph. Globs `**/*.{ts,js,svelte}`; `.svelte` `<script>` blocks are parsed via `svelte-eslint-parser` so their imports are subject to the same boundary rules (Rule 7 and the domain/adapter restrictions included).
- `pnpm typecheck` — TypeScript project references prevent out-of-graph imports at compile time.
- `pnpm check` — `svelte-check` across `@salt/ui-components` and `@salt/web-pwa`; catches Svelte template type errors not caught by `tsc`.
- `pnpm boundary:test` — Runs `.boundary-tests/run.sh` which lints deliberate violation fixtures (`.ts` and `.svelte`) and asserts each produces an error.
- `pnpm depcruise` — dependency-cruiser over the real `packages`/`apps` tree; enforces the no-cycles rule and the resolved-path subpath rules ESLint can't see. Runs in both the pre-commit hook and CI.
- Husky + lint-staged — blocks bad commits locally at pre-commit.
- GitHub Actions CI — blocks bad PRs before merge (runs `depcruise` as a dedicated step, not just the pre-commit hook).

## Package names

| Path                              | Package name            |
| --------------------------------- | ----------------------- |
| `packages/shared-types`           | `@salt/shared-types`    |
| `packages/domain`                 | `@salt/domain`          |
| `packages/adapters/firebase-sync` | `@salt/firebase-sync`   |
| `packages/adapters/observability` | `@salt/observability`   |
| `packages/ui-components`          | `@salt/ui-components`   |
| `packages/testing-utils`          | `@salt/testing-utils`   |
| `apps/web-pwa`                    | `@salt/web-pwa`         |
| `apps/cloud-functions`            | `@salt/cloud-functions` |
| `apps/storybook`                  | `@salt/storybook`       |

## Code search (Serena MCP)

Serena (`oraios/serena`) provides LSP-backed semantic code search. It is configured **TypeScript-only** (`languages: [typescript]` in `.serena/project.yml`), and that is deliberate.

- **Use it for the pure-TS layers** — `domain`, `shared-types`, `firebase-sync`, `observability`, `cloud-functions`, and `apps/web-pwa/src/lib/*Service.ts`. There `find_referencing_symbols` is exact.
- **Never use it to answer "what in the UI uses this?"** Serena's semantic tools cannot see `.svelte` files. A reference query for a symbol consumed only by components returns **zero results** — a confident, wrong answer. Use `grep`/`search_for_pattern` over `**/*.svelte` instead; imports are literal text and always accurate.
- **Serena is not the impact gate.** `pnpm depcruise`, `pnpm lint` (eslint-plugin-boundaries), and `pnpm typecheck` are authoritative for whether a change is legal — they encode what is *allowed*, not merely what is *connected*.
- `.serena/` is gitignored. If it is ever regenerated, re-apply `languages: [typescript]` and `ignored_paths: [".claude/**"]` — the auto-generated defaults are wrong for this repo (see `.gitignore`).
