# Recipe module

Store, hand-author, AI-parse, and canonicalise recipes — then push their
ingredients to the shopping list. This is the **foundation epic**. The ambitious
AI generation vision from #28 (AI Chef + equipment-aware Kitchen Agent) is a
deliberately **separate follow-on epic** built on top of this schema.

All data is family-shared (no per-user scoping), consistent with the rest of Salt.

## Scope split (decided in #28 design session)

| In this epic (foundation) | Deferred to the AI-generation epic |
| --- | --- |
| Recipe data model + persistence | **AI Chef** — conversational creative generation (Stage 1) |
| Manual CRUD (the schema stress-test) | **Kitchen Agent** — equipment-aware optimisation + faff-cost reasoning (Stage 2) |
| AI ingredient parsing | URL / photo recipe import |
| Ingredient canonicalisation (reuse `matchOrCreate`) | |
| Shopping-list extraction | |

Manual entry ships *before* any AI on purpose: the pain of hand-entering a real
recipe is the fastest way to discover schema flaws before we automate.

## Document

One Firestore document per recipe: `recipes/{id}`. **Whole-document
last-write-wins on `updatedAt`** (Firestore-as-master, no tombstones, no
revision counters — `revision`/`slug` from the #28 draft are dropped as
local-first residue). Writes go through an optimistic store with the
[snapshot-guard](salt-architecture.md) (drop `onSnapshot` echoes older than the
newest local edit).

## Schema (simplified from #28)

```
Recipe {
  id: string
  schemaVersion: 1
  title: string
  description: string | null
  ingredients: IngredientGroup[]
  steps: Step[]
  metadata: RecipeMetadata
  source: RecipeSource | null      // kept for later URL/photo import; no migration needed
  image: RecipeImage | null        // seam (issue #180); AI-epic generates/uploads. null = none
  notes: string | null             // user-authored, never parsed
  createdAt, updatedAt: string
}

IngredientGroup { id, name: string | null, items: Ingredient[] }   // "For the sauce"

Ingredient {
  id
  rawText: string                  // ALWAYS preserved — parsing is lossy, edits must round-trip
  parsed: ParsedIngredient | null  // null = unparsed / parse deferred
  canonId: string | null
  matchState: 'pending' | 'matched' | 'needs_approval' | 'failed'   // SAME enum as shoppingListItem
  isOptional: boolean
  firstUsedInStepId: string | null // seam (issue #180); id of the step that first uses it. AI-populated
}

ParsedIngredient { quantity: Quantity | null, unit: string | null, item: string,
                   preparation: string[], notes: string | null }

Quantity = { type:'single', value }
         | { type:'range', min, max }
         | { type:'mixed', whole, numerator, denominator }   // "1 ½ cups"

Step      { id, text, timer: StepTimer | null, note: string | null }   // note: one manual note (issue #180)
StepTimer { durationMinutes: number, description: string | null }

RecipeImage { url: string, source: 'ai' | 'upload' }   // structured so gen never clobbers an upload

RecipeMetadata { servings, totalTimeMinutes, prepTimeMinutes, cookTimeMinutes: number | null,
                 tags: string[] }

RecipeSource { type:'url'|'book'|'manual', url?, book?:{ title, author, page } }
```

Key invariants:
- **`rawText` is sacred.** Re-parsing with a better model, or a user edit, never
  destroys the original ingredient line.
- **Canon owns the name.** The recipe stores `canonId`, never an echoed canonical
  string. `parsed.item` is the cleaned pre-canon name only.
- `unit` is a plain string (consistent with `shoppingListItem.unit`), not a
  structured type.

### Schema extensions (issue #180)

Three additive fields were added after the Phase-1/2 hand-entry stress-test
(greenfield, `schemaVersion` stays `1`, no migration). Only `Step.note` is
functional in the foundation epic; `image` and `firstUsedInStepId` are **dormant
seams** whose features belong to the deferred AI epic (below) — the same
seam-now / AI-logic-later pattern as `source`/`recipeIds`.

- **`Step.note`** — one hand-authored free-text note per step (popover in the
  view). The parser never writes it; manual for hand-entered recipes.
- **`Ingredient.firstUsedInStepId`** — links an ingredient to the step that
  first uses it, **by `id` (never text)**. Powers a future step-view "ingredients
  introduced here, with quantities" display. Integrity: a re-parse must fill
  `parsed` on the *existing* ingredient/step without re-minting ids, and
  delete-step must clear inbound links — both owned by the AI epic that
  populates the links (no links exist until then).
- **`Recipe.image`** — `{ url, source: 'ai' | 'upload' }`, structured so the
  future auto-generation trigger can skip a user upload rather than clobber it.
  Reuses the canon **Tier-2** Storage conventions (see `docs/canon-icons.md`).

## Canon interaction — reuse `matchOrCreate`, no new port

The #28 draft's `CanonLookupPort` is obsolete. Canon matching is a **unified
server-side CF** (`matchOrCreate`) and canon owns the canonical name. Recipe
ingredient parsing becomes a **fifth entry point** into that same pipeline:
per parsed ingredient call `matchOrCreate({ rawName: parsed.item, rawText })`,
store the returned `canonId` + `matchState`. Unmatched/ambiguous results flow
into the **existing review queue** — no parallel logic, no new domain port.

## Cross-module seams (already shipped, awaiting this module)

- **Shopping list** — `shoppingListItem.sources` already carries a `recipe`
  `SourceRef` (`recipeId` + `servings` + `label`). Phase 5 populates it; servings
  scaling has a home there.
- **Meal plan** — `Day.recipeIds: string[]` ships empty today; the recipe IDs
  this module mints will populate it later.

## Architecture placement

A module inside existing packages — **no new package, no new dependency, no
layer-map change**. One Cloud Function (the parse flow) arrives in Phase 3.

- `packages/domain/src/recipe/` — entities, pure commands/queries
- `packages/domain/src/schemas/recipe*.ts` — zod schemas (validated on read in firebase-sync; on flow output in the CF)
- `packages/adapters/firebase-sync/src/recipe*.ts` — subscription + writes
- `apps/cloud-functions/src/` — `parseRecipeIngredients` Genkit callable (Phase 3), wrapped in `withAiTimeout`
- `apps/web-pwa/src/lib/recipeService.ts` + routes — store, list/view/edit UI

## Access & admin

Writes open to any authenticated (= allowlisted) member, matching the
shared-data / canon-write-path-open principle. No `AdminGuard` on recipes.

## Deferred: the AI-generation epic (own issue + design session)

Captured here so the design isn't lost:

- **Recipe image (Tier-2 hero).** `onRecipeCreated`-style trigger generates a
  photorealistic hero, reusing canon's Storage + public-read conventions, writing
  `image = { url, source: 'ai' }`. Manual **regenerate** callable (canon-icon
  pattern). **Optional upload** via a **CF-callable upload path** (client → CF →
  Storage; `firebase-sync` stays Storage-SDK-free), writing `source: 'upload'` —
  and the gen trigger must **skip** when `source === 'upload'`.
- **Ingredient→step link population + display.** AI sets `firstUsedInStepId`
  during AI-create / update / URL-parse; the step-view "ingredients introduced
  here, with quantities" display ships *with* the population so it has data the
  day it appears. Carries the integrity rule above (id stability; delete-step
  clears inbound links).
- **AI-authored step notes.** AI-create / update / parse-URL may populate
  `Step.note`; #179 Phase 3's ingredient parser does not (notes stay manual).
- **Kitchen Agent equipment knowledge** — keep equipment lean; pass each item's
  `name + accessories + rules[]` into the Agent prompt and let Gemini infer
  faff-cost / suitability. A Genkit equipment-**search tool** was considered but
  is premature at ~30 items (whole manifest fits in context); revisit if the
  manifest grows.
- **Baseline-kitchen assumption** — the manifest holds only *notable* kit (APO,
  Control Freak, Chinois). The Agent must assume a standard baseline (full pan
  range, saucepans, casseroles, knives) is always present and reason specially
  only about manifest items. Likely a short static "assumed baseline" list in the
  prompt rather than asking the user to enumerate generic kit.
- **Model separation** — don't tell the AI Chef the equipment (it hampers
  creativity); the Kitchen Agent applies hardware constraints afterward.
