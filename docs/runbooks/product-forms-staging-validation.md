# Runbook — Product-forms validation on staging

A repeatable, manual procedure for exercising and debugging the **product-forms**
capability (issues #500/#501/#504/#505) end-to-end against the **staging** project
(`s2-stage-ccb22`). Not part of the automated e2e suite — this drives the real web
UI and inspects Firestore directly, so it catches integration/AI/rollup behaviour
that unit + e2e tests don't.

Last run: 2026-07-15 (against the code merged to `main` on 2026-07-14).

---

## What product-forms does (one paragraph)

A recipe ingredient that names a **non-buyable component** of a buyable product
(e.g. `lime zest`, `egg yolk`, `passion fruit pulp`) should resolve to that
product's **parent canon** (Lime, Egg, Passion Fruit) with a **yield** describing
how much of the component one parent produces — instead of creating an orphan
`Lime Zest` canon. On the shopping list, several forms sharing a parent collapse
to buying **MAX(parent counts), not the sum** (one lime gives both juice and zest).

Pipeline (in `apps/cloud-functions/src/flows/canonicaliseRecipeIngredients.ts`),
per ingredient, in order:
1. **Tier 1 — resolve** against the `productForms` table (substring matcher, longest
   wins). A hit binds straight to the parent canon. No AI.
2. **Tier 2 — arbitrate** (`arbitrateProductForm`): only runs **if there is ≥1
   existing buyable canon item** to offer as a candidate parent. Decides whether the
   ingredient is a `component` (→ form, minting the parent if needed) vs an
   `action`/`none` (→ ordinary buyable).
3. **Tier 3 — normal match/create** (`arbitrateCanon`): the ingredient becomes its
   own canon item.

---

## Prerequisites

- **Chrome + Claude-in-Chrome** signed into the app as an admin member, OR a human
  driving the same steps. App URL: <https://s2-stage-ccb22.web.app>.
- **`firebase-staging` MCP server** (read Firestore + Cloud Functions logs, write/
  delete Firestore docs). Project: `s2-stage-ccb22`, database `(default)`.
- Ability to wipe/seed Firestore (this runbook deletes canon/forms between runs).

### Collections (Firestore paths)

| Data | Path |
|---|---|
| Canon items | `canonItems` |
| Product forms | `productForms` |
| Recipes | `recipes` |
| Shopping list items | `shoppingLists/<listId>/items` (subcollection) |

> The default shopping list id in staging at time of writing:
> `ea1ca2f2-cb07-45bf-87eb-1a1310f19d35` (see the `/#/shopping/<id>` URL).

---

## ⚠️ Gotchas discovered (read before running)

1. **Product forms cannot bootstrap from an *empty* canon.** Tier-2 arbitration is
   gated on `candidates.length > 0` (existing buyable canon). On a freshly-wiped
   canon, the *first* recipe's derivatives skip arbitration and become orphan
   canons (`Lemon Juice`, `Egg Yolk`, …). **Fix for testing:** ensure ≥1 unrelated
   buyable canon exists first (any item — e.g. add `caster sugar` to the list, or
   keep two plain items around). See finding #1.
2. **Matching is a manual step.** Saving a recipe leaves ingredients
   `matchState: "pending"`. You must open the recipe **view** page and click
   **Canonicalise** to run the pipeline. (Re-canonicalise only reprocesses
   ingredients whose canon match is missing/deleted.)
3. **Count-yield forms fed gram amounts don't roll up.** The parser normalises
   `2 egg yolks` → `100 g`, but the egg-yolk form yield is `count`. `convertYield`
   can't reconcile the units, so the parent-count rollup is skipped and the list
   shows a nonsensical `Free Range Egg (350 g)` (summed grams, MAX-not-sum bypassed).
   Seed manual forms with a **gram yield** to avoid this. See finding #2.
4. **AI image generation hangs the recipe view briefly** after first save. If the
   Chrome tab times out, re-navigate to the recipe URL and continue.

---

## Procedure

### 0. Confirm / establish canon state
- To validate the **cold-start gate** (finding #1): wipe `canonItems` + `productForms`
  entirely, then run step 1 — expect orphan derivatives, no forms.
- To validate **normal behaviour**: ensure ≥1 unrelated buyable canon exists first
  (e.g. run a throwaway recipe of plain items, or keep `Caster Sugar`/`Double Cream`).

### 1. Create a recipe (web UI)
1. Recipes → **New recipe** → set a Title.
2. **Parse from text** → paste the ingredient block (one per line) → **Parse**.
3. **Save**. You land on the recipe view; ingredients show a red ✗ (unmatched).

### 2. Canonicalise
1. On the recipe **view** page, click **Canonicalise** (top of the Ingredients card).
2. Wait ~8–12 s (concurrent AI calls). ✗ marks clear when done; the **Admin** badge
   increments by the number of new `needs_approval` items (canon + forms).

### 3. Inspect Firestore (MCP)
- `productForms` — each hit has `matchers`, `parentCanonId`, `label`,
  `yield {formUnit, amountPerParent}`, `needs_approval`.
- `canonItems` — parents minted (Lemon, Lime, …); confirm **no orphan derivative**
  canons (e.g. no standalone `Lemon Juice`).
- Recipe doc `recipes/<id>` — each ingredient's `canonId` should point at the parent.
- Cloud Functions logs (`canonicaliseRecipeIngredients`): the flow path
  `... > arbitrateProductForm > ...` confirms tier-2 ran; `... > arbitrateCanon > ...`
  is tier-3.

### 4. Add to shopping list & verify rollup
1. Recipe view → **Add to list** → review sheet shows resolved rows and converted
   quantities (e.g. `Lime (3 count)`). Toggle ADD/CHECK as needed → **Add N to list**.
2. Repeat for a second recipe sharing a parent.
3. Shop → confirm **MAX-not-sum** for shared form-parents (e.g. `Lime ×3`, not ×5)
   and plain **sum** for non-forms (e.g. `Caster Sugar 250 g`).
4. Cross-check `shoppingLists/<id>/items`: items are stored **per source** (not
   pre-combined); combining is a display concern keyed on `canonId` + unit.

### 5. Reset for a re-run
Delete, via MCP:
- `productForms/*` (all, or just the AI-seeded ones)
- `canonItems/*` (the ones under test)
- `recipes/<id>` (optional)
- `shoppingLists/<id>/items/*` (optional)

Then re-run from step 0.

---

## Reference test recipes (used 2026-07-15)

Quantities are chosen so parent counts differ, making MAX-vs-sum observable.

### Recipe A — "Lemon & Lime Posset"
```
90 ml freshly squeezed lemon juice
10 g lime zest
2 egg yolks
1 tsp scraped vanilla seeds
150 g caster sugar
300 ml double cream
```
Expected forms: `lemon juice→Lemon` (30 ml/lemon), `lime zest→Lime` (5 g/lime),
`egg yolks→Free Range Egg` (count), `vanilla seeds→Vanilla Pod` (count). Plain:
caster sugar, double cream.

### Recipe B — "Passionfruit Orange Meringue"
```
3 egg whites
2 egg yolks
15 g lime zest
80 g passion fruit pulp
120 g orange segments
100 g caster sugar
```
Expected: `egg whites` → new form, **reuses** Free Range Egg parent;
`egg yolks`/`lime zest` **resolve** to A's existing forms (no dup); `passion fruit
pulp` → new form + minted Passion Fruit; `orange segments` **declined** → own
buyable canon; caster sugar resolves.

Shopping-list checks (A+B): **Lime ×3** = MAX(2,3); **Caster Sugar 250 g** = sum;
⚠️ **Free Range Egg 350 g** = the count-yield/gram bug (finding #2).

### Recipe C — "Roast Chicken Two Ways" (manual-seed test)
```
2 chicken breasts
4 chicken thighs
1 whole chicken
1 tsp sea salt
```
- **C1** — canonicalise as-is: the AI **declines** `chicken breast`/`thighs` as
  forms (they're buyable) → they become own canons; `whole chicken` mints a
  `Whole Chicken` parent. (Confirms buyable parts are never auto-formed.)
- **C2** — delete the `Chicken Breast`/`Chicken Thigh` canons, then **seed** two
  `productForms` docs pointing at the `Whole Chicken` id, with **gram yields**:
  ```jsonc
  // productForms/<uuid>
  { "id": "<uuid>", "schemaVersion": 1,
    "matchers": ["chicken breast"], "parentCanonId": "<Whole Chicken id>",
    "label": "Chicken breast",
    "yield": { "formUnit": "g", "amountPerParent": 350 },
    "needs_approval": false, "updatedAt": "<iso>" }
  // thigh: amountPerParent 240
  ```
  Re-canonicalise → tier-1 binds both cuts to Whole Chicken (no AI). Add to list →
  **Whole Chicken ×2** = MAX(breast 1, thigh 2); with the direct whole chicken it
  displays as **"2 count + 1500 g"** (mixed-unit combine).

---

## Findings log

- **#1 — cold-canon gate** (GitHub #512). No forms are created when `canonItems`
  is empty; the first recipe's derivatives orphan. One unrelated canon item
  unblocks it. Blocks #505's parent-minting on a truly empty canon. (Never bites
  in prod; canon is never empty.)
- **#2 — count-yield vs gram-amount mismatch** (GitHub #513). Forms whose yield
  unit is `count` (eggs, vanilla pods) don't roll up when the parser stores the
  recipe amount in grams; the list shows raw summed grams and MAX-not-sum is
  bypassed. Gram-unit yields (lime zest 5 g/lime, passion fruit 20 g/fruit)
  convert and roll up correctly.
