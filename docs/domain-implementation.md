# Domain Modules & Coordinators — Pattern Guide (v1.3)

This document supplements the Salt 2.0 Architecture Contract.
It defines the repeatable pattern for structuring domain modules, enforcing
boundaries, and coordinating cross‑module workflows.

The architecture contract defines layers.
This document defines the shape inside the domain layer.

============================================================
1. Purpose
============================================================

Salt's domain layer is intentionally modular. Each domain area is isolated
into its own module with:

- its own entities
- its own commands
- its own queries
- its own ports (published as the module's public interface)

Modules communicate only through each other's **published** ports — never
by reaching into another module's internals.

Cross‑module *workflows* (flows that mutate two or more modules) are owned
by coordinators.

This pattern ensures:
- strict, machine‑enforceable boundaries
- locality of reasoning (a bug in canon stays in canon)
- consistent shape across modules (predictable navigation)
- clean testing
- long‑term maintainability against AI‑generated drift

Canon is used as the worked example.

============================================================
2. Domain Module Structure
============================================================

Each domain module follows this structure:

/packages/domain/src/<module>/
  entities/
  ports/
  commands/
  queries/
  index.ts          <-- the module's PUBLIC surface

This is the minimal structure that still provides:
- clear separation of concerns
- predictable navigation
- AI‑safe isolation
- clean test boundaries
- explicit port visibility

`index.ts` re‑exports exactly what other modules and coordinators are
allowed to use:
- published port interfaces
- entity types (when other modules legitimately need to pass them)
- nothing else

Anything not re‑exported from `index.ts` is internal and off‑limits to
other modules.

**Value objects** live in `entities/` alongside the entity that owns them.
There is no dedicated `value-objects/` folder. If a module ever
accumulates 5+ value objects, revisit and consider splitting then — not
preemptively.

============================================================
3. Module Boundaries
============================================================

The boundary rule is precise:

- A module **may** import another module's **published** port interfaces
  (via `<module>/index.ts`).
- A module **may not** import another module's internals — entities,
  commands, queries, port implementations, or any file under that
  module's subfolders.
- A module **may not** depend on a coordinator.

Allowed example:
  recipe/commands/parseRecipe.ts
    imports `CanonLookupPort` from `domain/canon` (the index)

Forbidden examples:
  recipe importing from `domain/canon/commands/...`
  recipe importing from `domain/canon/entities/...`
  recipe importing a coordinator
  canon importing anything from recipe or shopping

Boundaries are enforced by:
- ESLint rules (no-restricted-imports patterns on subpaths)
- tsconfig project references where applicable
- commit gateway checks (CI)

The point of these rules is mechanical, not philosophical: they exist so
that AI agents and humans cannot drift across boundaries without the
build catching it.

============================================================
4. Ports (Interfaces)
============================================================

Ports are interfaces a module owns and publishes. They describe either
- what the module needs from infrastructure (e.g. `CanonStorePort`), or
- what the module offers to other modules (e.g. `CanonLookupPort`).

Canon example:

CanonStorePort
  save(canonItem)
  load(canonId)
  list()
  delete(canonId)

CanonLookupPort
  findClosestMatch(ingredientName)
  normaliseName(rawName)

Ports:
- live inside the owning module's `ports/` folder
- are re‑exported from the module's `index.ts`
- are implemented by adapters (for infrastructure) or by the module's
  own commands/queries (for module‑offered ports)
- are consumed by other modules and by coordinators
- never contain business logic

The port is the contract. Everything else in the module is replaceable
behind that contract.

============================================================
4.1 Cross‑Cutting Ports
============================================================

Most ports belong to a specific module: they are defined inside that
module's `ports/` folder and re‑exported from its `index.ts`.

Some ports are **cross-cutting**: they are not owned by a single module
and serve system‑wide concerns. These live directly in
`/packages/domain/src/` and are re‑exported from `domain/index.ts`.

Current cross‑cutting ports:

ErrorReportingPort
  report(error: DomainError): void

MatchLoggingPort
  logMatch(entry: MatchLogEntry): void

Cross‑cutting ports:
- are implemented by adapters (e.g. ld-observability, observability
  solutions)
- are used by multiple modules or by the entire domain layer
- address concerns that do not fit a single module's responsibilities
- must be documented in this file (here)
- must be re‑exported from `domain/index.ts`
- follow the same naming and implementation contracts as module ports

Example:
  Canon module may call `ErrorReportingPort` to report a matching failure.
  Shopping module may call it separately.
  The port itself belongs to neither module — it is shared infrastructure.

Composition note: `ld-observability` ships two subpath entrypoints. The
default subpath implements `ErrorReportingPort` and `MatchLoggingPort` using
the browser LaunchDarkly SDK and is bundled into `web-pwa`. The
`@salt/ld-observability/server` subpath implements `MatchLoggingPort` for
Cloud Functions using the LaunchDarkly Node SDK, shipping CF spans to LD's
OTLP endpoint. `firebase-functions/logger` is used additively on the CF side
for top-level summary logs to Cloud Logging.

============================================================
5. Coordinators (Cross‑Module Workflows)
============================================================

Some operations span multiple modules. When a flow mutates two or more
modules, the orchestration lives in a coordinator.

Example:
"Add ingredient to shopping list → canonicalise → update list"

This touches the shopping module and the canon module. Neither should own
the orchestration; both should remain focused on their own concerns.

/packages/domain/src/coordinators/
  addIngredientToList.ts
  canonicaliseRecipeIngredients.ts

Coordinators:
- sequence operations across modules
- own cross‑module **failure semantics** (what happens if canon succeeds
  but shopping fails, retries, compensations, partial‑state handling)
- do not define entities, value objects, or domain invariants
- do not own data
- may import any module's published surface

Coordinators are not a goal. They are a tool for flows that genuinely
need cross‑module orchestration.

**Do not write a coordinator preemptively.** A coordinator that wraps a
single port call adds friction without value. Add a coordinator the first
time a flow actually mutates two modules. If the flow is "look up X from
canon, then do recipe stuff," recipe should call `CanonLookupPort`
directly — that is exactly what published ports are for.

============================================================
6. Worked Example: Canon Module
============================================================

Canon is the smallest module with the clearest dependencies.
It is also the **canonical sync exemplar**: it owns two entities with
different shapes (items and aisles) that both use the manifest-driven
local-first ↔ Firestore sync pattern. When implementing sync for a new
module (e.g. recipes), copy this pattern verbatim.

6.1 Responsibilities
--------------------
Canon owns:
- canonical ingredient definitions
- synonyms
- aisle classification
- merge semantics
- canonicalisation rules

Canon does not know:
- recipes
- shopping lists
- UI
- Firebase
- browser storage (IndexedDB, localStorage, etc.)

6.2 Ports
---------
Canon exposes the following sync-related ports via its `index.ts` (in
addition to CanonLookupPort):

CanonLocalStorePort
  in-memory cache for canon items — backs live Firestore subscriptions in
  the web client (web-pwa) and read-through reads in the cloud-functions
  matcher

CanonSyncTransportPort
  pull/subscribe for canon items — implemented by @salt/firebase-sync

AisleLocalStorePort
  in-memory cache for the aisles document — same pattern as above

AisleSyncTransportPort
  pull/subscribe for the aisles document — implemented by @salt/firebase-sync

Firestore is the live data layer: clients subscribe directly to the
canon collections and the aisles document, and offline reads/writes are
handled by Firestore's `persistentLocalCache`. There is no separate
manifest document, no per-scope revision counter, and no app-managed
cursor — the SDK owns durability.

CanonLookupPort
  canonicalisation logic used by other modules — implemented by canon's
  own queries

6.3 How Other Modules Use Canon
-------------------------------
Recipe module:
  imports `CanonLookupPort` from `domain/canon`
  calls `findClosestMatch()` directly

Shopping module:
  imports `CanonLookupPort` from `domain/canon`
  calls `normaliseName()` directly

Neither module reaches into canon's internals. Both depend only on the
published port interface, which is what makes canon's implementation
swappable without touching them.

6.4 Coordinator Example
-----------------------
A coordinator handles a flow that mutates both canon and shopping:

addIngredientToShoppingList(rawName):
  match = canonLookup.findClosestMatch(rawName)
  if no match:
    newCanon = canonCommands.createCanonItem(rawName)
    match = newCanon
  shoppingCommands.appendItem({ canonId: match.id, rawName })

This coordinator:
- creates new canon state (write to canon)
- adds to the shopping list (write to shopping)
- owns the failure semantics if either step fails

A simpler "recipe needs canonical name" lookup is **not** a coordinator —
it is a direct port call from recipe.

============================================================
7. Rules Derived From This Pattern
============================================================

1. Modules communicate only through published ports.
   The `index.ts` of each module is the public surface. Subpath imports
   into another module's folders are forbidden.

2. Each module defines and publishes its own ports.
   Ports describe what the module needs or offers, not how it's implemented.

3. Coordinators handle flows that mutate two or more modules.
   Add them when needed; do not write them speculatively.

4. Coordinators may contain orchestration and failure handling, but
   never entity definitions, validation rules, or domain invariants.

5. Adapters implement infrastructure ports.
   Adapters may depend on multiple modules; modules never depend on
   adapters or on coordinators.

6. UI calls commands, queries, and coordinators.
   UI never calls adapters directly.

7. Domain remains pure.
   No Firebase, no IndexedDB, no browser APIs, no side effects.

8. AI agents should work within a single module per task.
   Cross‑module changes should explicitly touch a coordinator (or add
   one). This is a guideline; the boundary rules above are what's
   actually enforced.

============================================================
8. Summary
============================================================

This document defines the repeatable pattern for domain modules:

- isolated modules with consistent shape
- explicit, published ports as the only cross‑module surface
- coordinators for genuine cross‑module workflows
- adapters implementing infrastructure ports
- UI calling domain, not infrastructure

Canon is the worked example. The same pattern applies to recipe, shopping,
and members.

The goal is not architectural purity. The goal is hard, enforceable
boundaries so that drift — by humans or AI agents — is caught by the
build instead of accumulating into spaghetti.
