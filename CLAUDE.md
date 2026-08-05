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
   - **Every route renders inside `AppShell`, with one sanctioned escape.** A **full-viewport route** runs without the shell's navigation chrome, and only for a genuinely modal, single-task mode (cook mode is the only one). Declare it in `apps/web-pwa/src/routes/fullViewport.ts` — `App.svelte` turns that into `AppShell`'s `chrome` prop. Never suppress the chrome from inside a page, and never merely paint over it with `fixed inset-0`: covered nav stays focusable and stays in the accessibility tree (issue #641). Obligations and the z-index ladder: [ui-spec-v05 §2](docs/design/ui-spec-v05.md), [ui-spec-v02 §4.1](docs/design/ui-spec-v02.md).
8. **No circular dependencies.** Enforced by dependency-cruiser.
9. **`shared-types` imports nothing from `@salt/*`.** It may only depend on external packages or nothing.
10. **Adapters never throw for operational errors.** All failures cross the boundary as `Failure<DomainError>` or `Conflict<T>` (see [docs/salt-architecture.md §7](docs/salt-architecture.md)).
11. **PostHog SDK only in `observability`.** `posthog-js` and `posthog-node` may be imported only in `packages/adapters/observability`, which wraps them behind the `ErrorReporting`/`MatchLogging` ports. Every other package and both apps depend on the `@salt/observability` ports (default subpath in `web-pwa`, `/server` in `cloud-functions`) — never the SDK directly. Enforced by `no-restricted-imports` in every non-observability layer and by depcruise's `no-posthog-outside-observability`.

## Data model conventions

- **All data is family-shared.** No `userId`, `householdId`, or per-user scoping on any collection. Equipment, recipes, shopping list, canon, aisles, meal planner, and shop days all live in single shared collections. Do not add user-scoped fields to new collections. (`shoppingDays/{YYYY-MM-DD}` carries a `setBy` uid, but it is **audit only** and deliberately unpinned in the rules — either partner may reschedule the other's shop.)
- **Per-user exceptions (only three).** `chatSessions`, `cookSessions`, and — third — `pushSubscriptions` are the only owner-scoped collections, deliberate exceptions to the family-shared rule because a chat history / an in-progress cook / which device to notify is personal. `pushSubscriptions` (issue #544) holds one web-push subscription per device, id `${uid}_${deviceHash}`, `ownerUid` set on create and pinned on update, read/delete gated on `resource.data.ownerUid` with a `resource == null` clause (deterministic id → subscribe/delete-before-exists, mirroring `cookSessions`). Cloud Functions read every subscription via the Admin SDK (bypassing rules) to send. There is also a server-owned, client-denied `timerDeliveries` ledger (exactly-once delivery dedupe) — a separate doc, never a write-back onto `cookSessions`. `cookSessions` uses a deterministic id (`${recipeId}_${uid}`) with `ownerUid == request.auth.uid` set on create and pinned on update; unlike `chatSessions` it has **no TTL** (a cook may span several days) and its orphan cleanup (deleted-recipe → delete session) is client-side only. Its read/delete rule also permits `resource == null` (issue #558) — the deterministic id means the cook page subscribes before the session exists, and a rule dereferencing `resource.data` on an absent doc is denied and kills the listener for good. Do not "tidy" that clause away; it is covered by both emulator suites. (`pushSubscriptions` mirrors this same `resource == null` clause for the same deterministic-id reason.)
- **Shop day is its own collection** (issue #629). `shoppingDays/{YYYY-MM-DD}` — one tiny family-shared doc per shop trip. Not a field on a shopping list (it is a fact about the household's *week*, read by both the planner and the reminder) and not on `mealPlans/{startDate}` (a week doc only exists once someone plans that week, but the shop happens regardless — and keeping it separate means marking a shop never contends with a concurrent full-doc week write under LWW). The date-keyed id is load-bearing: the daily reminder is one `get` by deterministic id, the planner reads a week with one range query over doc ids (no index), and clearing is a `delete` — there is no "cleared" state to model. `slot` (`'am' | 'pm'`) drives **copy and display only**, never timing.
- **`recipes` holds four kinds** (issues #637, #652). `kind: 'recipe' | 'outing' | 'cocktail' | 'placeholder'` — an `outing` (UI label "When you CBA") is a takeaway/night off with no ingredients and no method; a `cocktail` is a full recipe that is not dinner; a `placeholder` is neither — a stock photograph of "a good dinner, no particular dish", attached to a planner day that was planned in a sentence so that night gets a card like any other. Its mood is an ordinary `tags` entry (`bright` / `comfort`, constants exported from `@salt/domain`), deliberately **not** a schema field. `.default('recipe')` is mandatory (the realtime subscription skips docs that fail validation, so a required field would hide every production recipe), `ingredients`/`steps` stay required arrays (`[]`, never a discriminated union), and `kind` is immutable — set at create via `/recipes/new/:kind`, never editable. **Never branch on `kind` for behaviour outside `packages/domain`**: what an entry can do comes from the pure predicates `takesIngredients` / `isCookable` / `isPlannable` in `domain/src/recipe/queries/capabilities.ts`. Direct comparisons are permitted only to pick words, pictures or identity — `recipeKind.ts` copy/icons, the list's section chips, the planner picker badge, and the CF art-direction prompt selectors in `generateRecipeImage.ts` / `describeRecipeScene.ts` — never to decide whether something exists or is allowed. Outings and placeholders are **not** separate collections — they occupy a planner slot in place of a recipe; if they need their own fields, add optional nullable fields to the recipe doc first. Note what `isPlannable` actually gates: whether a kind is **offered in the planner picker**, not whether it may sit in a day. A placeholder is `isPlannable: false` and still occupies a slot, because it is attached on its own rather than chosen.
- **No soft-delete, no tombstones.** Firestore is the master; delete means delete. Canon has a vestigial `deletedAt` field from the local-first era — do not copy this pattern to new schemas.
- **LWW per document.** Last-write-wins at the document level, enforced entirely by Firestore's full-document `setDoc` — no merge logic at any layer. There is no live conflict-resolution policy today; if a document ever needs bespoke resolution it belongs in `packages/domain` (pure), never in an adapter. Note the granularity: a client `setDoc` rewrites the whole doc, so it can clobber a field a CF trigger wrote concurrently (e.g. `thumbnail`/`embedding`) — that is the LWW contract, not a bug. See the LWW integration test in `firebase-sync`.

## AI / Genkit conventions

- **All AI access via Genkit callables.** Every Gemini call goes through a Genkit flow invoked as a Firebase callable Cloud Function. No AI API keys in the client.
- **Wrap every AI call in `withAiTimeout`.** Bare Genkit flow calls have no built-in timeout and will hang the function for the full 60 s quota on a slow or hung model response. This applies to callable flows and Firestore triggers alike. Functions calling AI must also declare their AI-related secrets.
- **Server-side trace propagation is env-gated.** Callables carry the browser's `traceparent` on a named, typed, optional wire field (stripped at the entrypoint so domain flows stay pure); Firestore triggers carry it as an additive `traceContext` field on the written doc. Both degrade to a plain root trace and never throw (Rule 10), and both are suppressed under `GENKIT_TELEMETRY_SERVER`. **Full contract — precedence, the six affected callables, the trigger chain, and the reasoning behind each choice — is in [apps/cloud-functions/CLAUDE.md](apps/cloud-functions/CLAUDE.md)**, which loads automatically when working in that app. Read it before touching callable entrypoints, trigger trace plumbing, or `@salt/observability/server`.

## Workflow

- **Issue-first for substantial changes.** New packages, new dependencies, layer-map edits, and cross-package refactors require a GitHub issue and explicit go-ahead before implementation. Design Q&A in chat is not a greenlight.
- **New dependencies pin to the current latest.** Never write a version range from memory — model training data lags the registry by a long way. Check what is actually published (`npm view <pkg> version`, or `pnpm add <pkg>` which resolves latest for you) and use that major. An older major is allowed only for a stated reason (a peer-dep ceiling, a known-broken release, an upstream pin — e.g. the OTel 1.x pin held by `@genkit-ai/google-cloud`), and that reason goes in the PR description. Precedent: `resend` was added as `^4.0.0` in #585 (2026-07-24) when 6.x had been out for a year, and Dependabot flagged it within days.
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

## Docs map — read these when the task touches their area

`docs/` is **not** auto-loaded; only this file is. Everything below is invisible
unless you open it deliberately, so treat this table as the index. Each doc holds
knowledge that is **not** recoverable from the code — decisions, gotchas, external
setup, and contracts. Read the one that matches your task **before** editing.

Rule for maintaining them: a doc earns its place by holding what code cannot say.
If something is already explained in a header comment next to the code, it does
**not** get restated here or in `docs/` — one source, no duplication.

The **Tracks** column is the routing source for the nightly doc review
([.github/workflows/nightly-doc-review.yml](.github/workflows/nightly-doc-review.yml)) —
that job reads this table instead of keeping its own copy, so adding a row here is
all it takes to bring a doc into nightly review. Keep the globs accurate.

| Read this | Tracks | When |
| --- | --- | --- |
| [docs/salt-architecture.md](docs/salt-architecture.md) | `packages/**`, `apps/**`, `eslint.config.*`, `.dependency-cruiser.*`, `pnpm-workspace.yaml` | The prose contract behind this file: §3 dependency graph, §4 domain, §6 adapters, §7 adapter errors (§7.6 error-reporting policy), §8 cloud functions, §9 PWA, §11 enforcement. Any layering/boundary question. |
| [docs/domain-implementation.md](docs/domain-implementation.md) | `packages/domain/**` | Writing anything in the domain layer — module/coordinator pattern. |
| [docs/matching-pipeline.md](docs/matching-pipeline.md) | `packages/domain/src/canon/**`, `packages/adapters/**`, `apps/cloud-functions/**` | Canon matching: stages, thresholds, AI arbitration, `needs_approval`, and the **live** `MatchLogEntry` logging schema. |
| [docs/canon-icons.md](docs/canon-icons.md) | `apps/cloud-functions/src/triggers/onCanonItemWritten.ts`, `apps/cloud-functions/src/imaging/**` | Canon pictograms — generation pipeline, storage, rendering, and the verbatim prompt (reproduce exactly). |
| [docs/recipe-module.md](docs/recipe-module.md) | `packages/domain/src/recipe/**`, `packages/domain/src/schemas/recipe.ts`, `apps/cloud-functions/src/triggers/onRecipeWritten.ts` | Recipe schema, canon batch interaction, shopping-list extraction. |
| [docs/meal-planning.md](docs/meal-planning.md) | `packages/domain/src/mealPlan/**`, `apps/web-pwa/src/routes/mealplan/**`, `apps/web-pwa/src/lib/mealPlanService.ts` | Planner: week identity, `firstDayOfWeek`, shop day (#629), conflict model, which weeks may be written. |
| [docs/ai-kitchen-assistant.md](docs/ai-kitchen-assistant.md) | `apps/cloud-functions/src/flows/**`, `apps/web-pwa/src/routes/chat/**`, `apps/web-pwa/src/routes/recipes/CookModePage.svelte`, `apps/web-pwa/src/lib/cook*.ts` | Chef chat / cook mode — design principles and per-user data exceptions. |
| [docs/releases.md](docs/releases.md) | `.github/workflows/deploy-*.yml`, `firebase.json`, `.firebaserc`, `apps/*/.env*` | Deploying, the three Firebase projects, and where config/secrets live. |
| [docs/data-refresh.md](docs/data-refresh.md) | `scripts/*firestore*.mjs`, `scripts/restore-*.mjs`, `storage.rules` | Copying data between environments, plus the cross-project image-bucket posture. |
| [docs/e2e.md](docs/e2e.md) | `apps/web-pwa/e2e/**`, `docker/**`, `apps/web-pwa/playwright.config.ts`, `vitest.config.ts`, `firebase.test.docker.json` | Running/debugging e2e + emulator integration suites; poisoned-environment recovery. |
| [docs/e2e-test-spec.md](docs/e2e-test-spec.md) | `apps/web-pwa/e2e/**` | **Writing or reviewing** an e2e test — non-functional rules and the reviewer checklist. |
| [docs/visual-regression.md](docs/visual-regression.md) | `.github/workflows/chromatic.yml`, `apps/storybook/**` | Chromatic VR: why it is selective and non-blocking, accepting diffs. |
| [docs/error-reporting-calibration.md](docs/error-reporting-calibration.md) | `packages/adapters/observability/**` | Verifying reporting changes in PostHog; the intentional asymmetries that are **not** bugs. |
| [docs/runbooks/product-forms-staging-validation.md](docs/runbooks/product-forms-staging-validation.md) | `packages/domain/src/productForm/**` | Exercising product-forms on staging (live — see #512). Gotchas section first. |
| [docs/runbooks/app-check-preflight.md](docs/runbooks/app-check-preflight.md) | `apps/cloud-functions/src/tracedCallable.ts`, `apps/web-pwa/.env.*` | **Before flipping any App Check enforcement setting** (#718). Two independent origin allowlists that nothing keeps in agreement — the gap that broke prod sign-in on 2026-08-05. |
| [infra/bigquery-export/README.md](infra/bigquery-export/README.md) | `infra/bigquery-export/**` | Firestore→BigQuery changelog export (#684): why the manifest is isolated from CI deploys, the prod-only install + backfill procedure. |

### Design docs (`docs/design/`)

- [design.md](docs/design/design.md) — **machine-consumed, not prose.** Its YAML
  frontmatter is the source of truth for the Culinary Modernist palette and
  tokens; `packages/ui-components/scripts/check-theme.ts` and
  `tests/tokens.theme.test.ts` read it. Editing tokens starts here, not in CSS.
- [component-tokens.md](docs/design/component-tokens.md) — the procedure when a
  component "looks wrong" and the fix should become a token. Follow it rather
  than inventing tokens.
Design docs track `packages/ui-components/**` and `apps/web-pwa/src/**` styling.

- **ui-spec-v02 → v06 are cumulative, never superseding.** v0.2 holds the
  foundations (boundaries, package surface, event naming, styling rules) and stays
  in force for every later version; each later spec only adds components —
  [v03](docs/design/ui-spec-v03.md) RadioGroup/Select/Slider/Sheet/Toast,
  [v04](docs/design/ui-spec-v04.md) Combobox + `ListPage` selection mode,
  [v05](docs/design/ui-spec-v05.md) `ListPage` fill mode,
  [v06](docs/design/ui-spec-v06.md) `ImageCropper` free-aspect mode. Touching
  `@salt/ui-components` means reading [v02](docs/design/ui-spec-v02.md) **plus**
  the spec that owns your component. The specs are binding: if something is
  missing or ambiguous, stop and extend the spec rather than inventing.

## Code search (Serena MCP)

Serena (`oraios/serena`) provides LSP-backed semantic code search. It is configured **TypeScript-only** (`languages: [typescript]` in `.serena/project.yml`), and that is deliberate.

- **Use it for the pure-TS layers** — `domain`, `shared-types`, `firebase-sync`, `observability`, `cloud-functions`, and `apps/web-pwa/src/lib/*Service.ts`. There `find_referencing_symbols` is exact.
- **Never use it to answer "what in the UI uses this?"** Serena's semantic tools cannot see `.svelte` files. A reference query for a symbol consumed only by components returns **zero results** — a confident, wrong answer. Use `grep`/`search_for_pattern` over `**/*.svelte` instead; imports are literal text and always accurate.
- **Serena is not the impact gate.** `pnpm depcruise`, `pnpm lint` (eslint-plugin-boundaries), and `pnpm typecheck` are authoritative for whether a change is legal — they encode what is *allowed*, not merely what is *connected*.
- `.serena/` is gitignored. If it is ever regenerated, re-apply `languages: [typescript]` and `ignored_paths: [".claude/**"]` — the auto-generated defaults are wrong for this repo (see `.gitignore`).
