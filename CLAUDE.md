# Salt 2.0 — Architecture Contract for AI Agents

This file is the authoritative, machine-enforced architecture contract. Violating these rules will cause CI to fail. The full prose contract lives in [docs/salt-architecture.md](docs/salt-architecture.md).

**Where a fact belongs.** This file is auto-loaded into every session and every
subagent, so its size is paid before any code is read — `pnpm context:check` caps
it. Something earns a place here only if an agent needs it **before** knowing which
directory it is in, or it spans three or more packages. Otherwise:

| The fact is…                   | It goes…                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| already stated by the code     | in a comment at the declaration; link to that                                                                                            |
| needed only inside one package | in a nested `CLAUDE.md` there ([apps/cloud-functions/CLAUDE.md](apps/cloud-functions/CLAUDE.md)) — loaded only when working in that tree |
| looked up once per task        | in a doc under `docs/`, with a row in [docs-map.md](docs-map.md)                                                                         |

## How to report to Daniel

Daniel is not a coder. Technical explanation is not just unhelpful to him, it is
what buries the thing he actually has to do. **Every reply obeys this shape.**

1. **His decision or next action goes first**, in bold — before any explanation.
   If there is nothing for him to do, say so in those words ("Nothing needed from
   you") rather than leaving him to work it out.
2. **Then two or three plain sentences**: what changed, who it affects when they
   use the app, and why it matters. Consequences, never mechanism.
3. **Then risk**, one line, only when there is a real one.
4. **Nothing else.** No walkthrough of how the code works, no restating the
   request, no listing options you already rejected, no summary of what you just
   said. State a thing once.

**Technical detail is written down, not spoken.** When the reasoning genuinely is
technical, it belongs in the PR description, the issue, or a doc — then link it
and move on ("detail is in the PR"). Never inline it in chat as a courtesy.
Jargon that survives into a reply gets a plain-English gloss in brackets, or gets
cut.

**Uncertainty is a decision to surface, not detail to bury.** If you need his
call, the whole reply is that question and what each answer costs him.

Chat replies only — commit messages, PR bodies and docs stay as technical as
they need to be.

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
3. **No IndexedDB / browser storage.** No package may import `idb`, `idb-keyval`, or touch `window.indexedDB` / `localStorage` / `sessionStorage` / `caches` directly. Offline reads and writes are handled by Firestore's `persistentLocalCache`. **Exactly three sanctioned keys exist**, all in `apps/web-pwa` (never an adapter), each wrapped so storage being unavailable degrades quietly: the two pre-authentication sign-in keys in [auth.svelte.ts](apps/web-pwa/src/lib/auth.svelte.ts) and the one-shot stale-deploy reload guard in [pwa.ts](apps/web-pwa/src/lib/pwa.ts). Each is justified in a comment at its own declaration — read that before adding a fourth, because the bar is "pre-auth or page-load mechanics with no Firestore-backed alternative", and nothing has cleared it since. Everything else stays forbidden.
4. **Adapters do not import each other.** `firebase-sync` ↔ `observability` is forbidden in both directions.
5. **Cloud Functions do not import the default `@salt/observability` subpath.** That subpath wraps the browser-only PostHog SDK (`posthog-js`) and cannot run in Node. Server-side observability uses `@salt/observability/server` (`posthog-node` + native OpenTelemetry). `firebase-functions/logger` continues to be used additively for CF-side match logs.
6. **No importing apps.** Nothing may import `@salt/web-pwa`, `@salt/cloud-functions`, or `@salt/storybook`.
7. **UI primitives go through `@salt/ui-components`.** `apps/web-pwa` must never import `shadcn-svelte`, `bits-ui`, or `melt-ui` directly — always through `@salt/ui-components`.
   - **Every route renders inside `AppShell`, with one sanctioned escape.** A **full-viewport route** runs without the shell's navigation chrome, and only for a genuinely modal, single-task mode (cook mode is the only one). Declare it in `apps/web-pwa/src/routes/fullViewport.ts` — `App.svelte` turns that into `AppShell`'s `chrome` prop. Never suppress the chrome from inside a page, and never merely paint over it with `fixed inset-0`: covered nav stays focusable and stays in the accessibility tree (issue #641). Obligations and the z-index ladder: [ui-spec-v05 §2](docs/design/ui-spec-v05.md), [ui-spec-v02 §4.1](docs/design/ui-spec-v02.md).
8. **No circular dependencies.** Enforced by dependency-cruiser.
9. **`shared-types` imports nothing from `@salt/*`.** It may only depend on external packages or nothing.
10. **Adapters never throw for operational errors.** All failures cross the boundary as `Failure<DomainError>` or `Conflict<T>` (see [docs/salt-architecture.md §7](docs/salt-architecture.md)).
11. **PostHog SDK only in `observability`.** `posthog-js` and `posthog-node` may be imported only in `packages/adapters/observability`, which wraps them behind the `ErrorReporting`/`MatchLogging` ports. Every other package and both apps depend on the `@salt/observability` ports (default subpath in `web-pwa`, `/server` in `cloud-functions`) — never the SDK directly. Enforced by `no-restricted-imports` in every non-observability layer and by depcruise's `no-posthog-outside-observability`.
12. **An invariant you state, you make mechanical — or you state its limits.** A safety property asserted in a header comment, a doc, a PR body or a test name and guaranteed by nothing is the one defect class every gate below is blind to — campaign #1064 shipped five, and three would have destroyed production data. Pin the claim with a test that goes red when it breaks, or state the claim's real boundary; never the unqualified absolute. Convention, not enforcement, unlike rules 1–11: the worked example, and why no lint rule is possible, are in [`.claude/commands/run.md`](.claude/commands/run.md) → _Standing rules_.

## Data model conventions

Mechanics — id schemes, the `firestore.rules` clauses that look redundant and are
not, per-collection shapes, and the per-boundary Zod failure table — are in
[docs/data-model.md](docs/data-model.md). Read it before adding a collection,
changing an id scheme, or editing `firestore.rules`. The invariants below hold
everywhere and are not negotiable:

- **All data is family-shared.** No `userId`, `householdId`, or per-user scoping on any collection. Equipment, recipes, shopping list, canon, aisles, meal planner, shop days and guided plans all live in single shared collections. Do not add user-scoped fields to new collections.
- **Per-user exceptions (only four).** `chatSessions`, `cookSessions`, `pushSubscriptions`, `kitchenTimers` — a chat history, an in-progress cook, which device to notify, whose egg is boiling. There is no fifth. A uid stored for **audit** (`shoppingDays.setBy`, `recipes.createdBy` / `lastEditedBy` — snapshots of `Member.name`, displayed and nothing else) is not scoping: never checked on read, never pinned on update, never a gate on capability, availability or ordering. Do not read one as an exception.
- **No soft-delete, no tombstones.** Firestore is the master; delete means delete.
- **LWW per document.** Last-write-wins at the document level, enforced entirely by Firestore's full-document `setDoc` — no merge logic at any layer. There is no live conflict-resolution policy; if a document ever needs bespoke resolution it belongs in `packages/domain` (pure), never in an adapter. Note the granularity: a client `setDoc` rewrites the whole document, so it can clobber a field a CF trigger wrote concurrently (e.g. `thumbnail`/`embedding`) — that is the contract, not a bug. See the LWW integration test in `firebase-sync`.
- **Never branch on `recipes.kind` for behaviour outside `packages/domain`.** What an entry can do comes from the pure predicates `takesIngredients` / `isCookable` / `isPlannable` in `domain/src/recipe/queries/capabilities.ts`. Direct comparisons are permitted only to pick words, pictures or identity — `recipeKind.ts` copy/icons, the list's section chips, the planner picker badge, and the CF art-direction prompt selectors in `generateRecipeImage.ts` / `describeRecipeScene.ts` — never to decide whether something exists or is allowed.
- **Production data back-compat.** Canon, Aisles, Equipment, Shopping List, Meal Planner and Recipes hold real production data — a schema change must be backward-compatible on read, or carry a one-off migration.

## AI / Genkit conventions

- **All AI access via Genkit callables.** Every Gemini call goes through a Genkit flow invoked as a Firebase callable Cloud Function. No AI API keys in the client.
- **Wrap every AI call in `withAiTimeout`.** Bare Genkit flow calls have no built-in timeout and will hang the function for the full 60 s quota on a slow or hung model response. This applies to callable flows and Firestore triggers alike. Functions calling AI must also declare their AI-related secrets. Three rules make the convention mechanical rather than remembered (issue #915), and `apps/cloud-functions/tests/aiTimeoutGuard.test.ts` enforces all of them by scanning the whole of `apps/cloud-functions/src`:
  - **The wrapper goes in the file that calls the model**, never at a caller. A flow may be invoked from several places — and several are exported as callables in their own right, which no caller wraps — so a caller-side deadline is coverage of the callers that remembered, not of the flow. A second wrapper nested around a flow that already has one is also wrong: two budgets disagree, and the outer (house default 20 s) pre-empts and retries an inner one sized for the work.
  - **`ai.generateStream` needs `withAiStreamTimeout`, not `withAiTimeout`.** A promise wrapper cannot bound a stream: applied to the aggregated response it is not reached until the drain loop has finished, so a model that goes quiet mid-stream is unguarded. The stream wrapper races each chunk against an idle timer — a stream is bounded by silence, never by total duration.
  - **`{ timeoutMs: 55_000, retries: 0 }` is `AI_TEXT_FLOW_TIMEOUT`**, exported beside `withAiTimeout`. A site that deliberately wants other values (the image flows, `generateChatTitle`) keeps its own literal and says why.
- **Server-side trace propagation is env-gated.** Callables carry the browser's `traceparent` on a named, typed, optional wire field (stripped at the entrypoint so domain flows stay pure); Firestore triggers carry it as an additive `traceContext` field on the written doc. Both degrade to a plain root trace and never throw (Rule 10), and both are suppressed under `GENKIT_TELEMETRY_SERVER`. **Full contract — precedence, which callables are affected, the trigger chain, and the reasoning behind each choice — is in [apps/cloud-functions/CLAUDE.md](apps/cloud-functions/CLAUDE.md)**, which loads automatically when working in that app. Read it before touching callable entrypoints, trigger trace plumbing, or `@salt/observability/server`.

## Workflow

- **Issue-first for substantial changes.** New packages, new dependencies, layer-map edits, and cross-package refactors require a GitHub issue and explicit go-ahead before implementation. Design Q&A in chat is not a greenlight.
- **An issue is filed through `/spec`, `/defect` or `/refactor-spec`** — never a free-form `gh issue create`. Only those three shapes are executable by `/run`, and `scripts/check-spec-shape.mjs` decides which body qualifies (it gates the `specced` label). The commands are user-invoked, so an agent that needs an issue mid-flight — a campaign parking `BLOCKED: oversized`, say — spawns a subagent pointed at `.claude/commands/<cmd>.md` and lets it run the flow. Writing the body yourself is the fallback, and then you verify it with that script. Departing from this takes a stated reason.
- **New dependencies pin to the current latest.** Never write a version range from memory — model training data lags the registry by a long way. Check what is actually published (`npm view <pkg> version`, or `pnpm add <pkg>` which resolves latest for you) and use that major. An older major is allowed only for a stated reason (a peer-dep ceiling, a known-broken release, an upstream pin — e.g. the OTel 1.x pin held by `@genkit-ai/google-cloud`), and that reason goes in the PR description. Precedent: `resend` was added as `^4.0.0` in #585 (2026-07-24) when 6.x had been out for a year, and Dependabot flagged it within days.
- **Production data back-compat.** Canon, Aisles, Equipment, Shopping List, Meal Planner, and Recipes collections hold real production data — schema changes must be backward-compatible on read, or require a one-off migration. (Recipes lost their greenfield status when the module shipped to all members in #240, 2026-06-17; treat recipe schema changes like any other production collection from here on.) See also: Zod schema conventions below.

### Worktree rules — where am I running?

A few commands seize host-global singletons (fixed ports, the emulator compose
projects, `.emulator-data`, the `:5174` Vite) and would kill the dev session Daniel
is sitting in or corrupt another agent's e2e run: `dev`, `dev:genkit`,
`dev:emulators`, `stop:emulators`, `test:emulator`, and `@salt/web-pwa`'s `e2e` /
`e2e:ui` / `e2e:coverage`. **Ask Daniel before running one from a linked worktree**,
then re-run with `SALT_TAKE_HOST=1`.

You do not have to remember which: [scripts/host-guard.mjs](scripts/host-guard.mjs)
refuses them in a linked worktree, kills nothing, and prints what it protected, the
override, and the safe alternatives. Its header comment carries the reasoning,
including why a cloud VM must never be guarded.

**Everything short of e2e runs freely anywhere, no permission needed:** `lint`,
`typecheck`, `check`, `test`, `depcruise`, `boundary:test`, `format`,
`format:check`, `pnpm -r build` (there is no root `build` script). That is how you
validate work in a worktree.

**A cloud session is deliberately AI-key-less.** No secrets store, and
`apps/cloud-functions/.secret.local` exists only on the Mac. Build, typecheck, check
and unit tests need zero configuration; anything needing Gemini goes through the
`FUNCTIONS_AI_FAKE` seam or does not run at all. Do not go hunting for keys you will
never find.

## Zod schema conventions

- **SHARED schemas live in `@salt/domain/schemas`.** Any shape crossing an `@salt` boundary — every Firestore document, every flow/callable wire contract an adapter also names — is defined under `packages/domain/src/schemas/` and never in an adapter, an app, or `@salt/shared-types`. Narrowed from "never in apps" by #932: a schema wholly internal to one app, crossing no boundary and having no second declaration to drift from, may stay there — parsers for third-party responses (scraped JSON-LD, Google's model catalog) and admin-only callable inputs are the standing cases. Moving those would put a foreign wire shape in the pure domain with no consumer. If an adapter also names the shape, it is shared, and it moves.
- **Schema-first.** Define the schema, derive the type with `z.infer`. Never maintain a hand-written type alongside a schema for the same shape.
- **Validate at trust boundaries only** — AI/Genkit flow outputs, Firestore reads (in `firebase-sync`), callable CF inputs, and "type laundering" sites (`as` casts, `unknown` narrowings, `JSON.parse`, string → structured parsers). **Not** on internal domain → domain calls, adapter internals, or anything the compiler already proves.
- **Always `.safeParse()`, never `.parse()`** at those boundaries. What to do with the failure differs per boundary and is tabulated in [docs/data-model.md](docs/data-model.md) — the short version: adapters return `Failure`, list reads skip the bad doc, callables throw `HttpsError`, triggers log and return.

## Observability / error-reporting conventions

Errors reach PostHog only via `ErrorReportingPort`, gated on the `DomainError`
**category** — never by which call site happens to have a `catch`/`onError`, so
coverage is uniform across write failures, realtime `onError` and server CF.
Reporting surfaces what the friendly-message path would hide; it is not a mirror of
every `Failure`. Best-effort, never throws (Rule 10). Full policy:
[docs/salt-architecture.md §7.6](docs/salt-architecture.md); calibration in
[docs/error-reporting-calibration.md](docs/error-reporting-calibration.md).

- **Report:** `StorageError`, `SyncError`, uncategorised/unknown errors, and (server-side) unhandled CF exceptions + AI/Genkit flow failures. `AuthError` too — **except** the sign-out / token-refresh `permission-denied` race on in-flight listeners.
- **Do not report:** `NetworkError`/offline, `ValidationError`, `NotFound`, `ConflictError`, and that sign-out race.
- **Scrub raw user input** (e.g. canon match text) from reported context. Data is family-shared, but free-form user content must not be attached.
- **Not lint-enforceable** — review, the gating helper and unit tests, not `eslint-plugin-boundaries`.

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

## Docs map — [docs-map.md](docs-map.md)

`docs/` is **not** auto-loaded, and neither is the map. **Before editing anything
under `packages/`, `apps/`, `scripts/`, `infra/` or `.github/workflows/`, open
[docs-map.md](docs-map.md)** and read the row matching what you are touching. Each
doc there holds knowledge that is **not** recoverable from the code — decisions,
gotchas, external setup, and contracts. A doc missing from the map is invisible to
every agent, so a new doc gets its row in the same commit.

It is a lookup table consulted once per task rather than a rule you must hold in
mind, which is why it is one file away instead of inline. It remains the routing
source for the PR doc review and is still checked by `pnpm docsmap:check`.

Rule for maintaining docs: a doc earns its place by holding what code cannot say.
If a header comment beside the code already explains it, it does **not** get
restated in `docs/` — one source, no duplication.

## Code search (Serena MCP)

Serena (`oraios/serena`) provides LSP-backed semantic code search. It is configured **TypeScript-only** (`languages: [typescript]` in `.serena/project.yml`), and that is deliberate.

- **Use it for the pure-TS layers** — `domain`, `shared-types`, `firebase-sync`, `observability`, `cloud-functions`, and `apps/web-pwa/src/lib/*Service.ts`. There `find_referencing_symbols` is exact.
- **Never use it to answer "what in the UI uses this?"** Serena's semantic tools cannot see `.svelte` files. A reference query for a symbol consumed only by components returns **zero results** — a confident, wrong answer. Use `grep`/`search_for_pattern` over `**/*.svelte` instead; imports are literal text and always accurate.
- **Serena is not the impact gate.** `pnpm depcruise`, `pnpm lint` (eslint-plugin-boundaries), and `pnpm typecheck` are authoritative for whether a change is legal — they encode what is _allowed_, not merely what is _connected_.
- `.serena/` is gitignored. If it is ever regenerated, re-apply `languages: [typescript]` and `ignored_paths: [".claude/**"]` — the auto-generated defaults are wrong for this repo (see `.gitignore`).
