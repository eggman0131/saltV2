# Runbook — Product-forms validation on staging

A repeatable, manual procedure for exercising and debugging the **product-forms**
capability (issues #500/#501/#504/#505) end-to-end against the **staging** project
(`s2-stage-ccb22`). Not part of the automated e2e suite — this drives the real web
UI and inspects Firestore directly, so it catches integration/AI/rollup behaviour
that unit + e2e tests don't.

Last run: 2026-07-15 (against `main` incl. #515 — count-yield egg/protein rollup;
re-validated by re-parsing recipes A & B, see gotcha #5 and finding #2).

> ⚠️ **The expected numbers below were re-derived for #518 (sum-per-form, then MAX)
> but have NOT yet been observed on staging.** They are computed from the rule and
> from this runbook's own documented recipes/yields — the arithmetic is shown inline
> so a runner can check it. The next staging run should confirm them and update this
> line. Where the #518 issue's headline numbers do NOT match what these recipes can
> actually produce, that is called out explicitly rather than reconciled away — see
> **Recipe C/D** and finding #3.

---

## What product-forms does (one paragraph)

A recipe ingredient that names a **non-buyable component** of a buyable product
(e.g. `lime zest`, `egg yolk`, `passion fruit pulp`) should resolve to that
product's **parent canon** (Lime, Egg, Passion Fruit) with a **yield** describing
how much of the component one parent produces — instead of creating an orphan
`Lime Zest` canon. On the shopping list, the parent count for one row is:

```
Σ(whole/direct) + MAX over forms of ( Σ that form's demand across recipes )
```

- **The SAME form in several recipes SUMS.** Zest 10 g + 15 g = 25 g of zest = 5 limes.
  Two recipes that each want zest genuinely need more limes.
- **DIFFERENT forms of one parent MAX.** One lime gives both juice and zest; one egg
  gives its yolk AND its white at once — so 4 yolks + 3 whites is 4 eggs, not 7.
- **Whole/direct purchases SUM on top.** A bird bought for its thighs is eaten as
  thighs and can't also be the whole roast.
- **Rounding happens ONCE, on the summed demand** — never per recipe. At a 4 g/lime
  yield, 6 g + 6 g of zest is 12 g = 3 limes; rounding each recipe first gives 2 + 2 = 4.

Before #518 the list MAXed the already-rounded per-recipe counts for *every* case,
which under-bought whenever two recipes wanted the same form (the Lime case below).

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
3. **A form's yield unit must agree with how the parser stored the amount — in BOTH
   directions.** `formParentCount`/`convertYield` return null on a unit mismatch, so
   the parent-count rollup is silently skipped and the row degrades to raw amounts.
   Two distinct ways to trip it:
   - **Count yield fed grams** (the original bug, #513): pre-#515 the parser
     normalised `2 egg yolks` → `100 g` against a `count` yield → nonsensical
     `Free Range Egg (350 g)`. Still live for anything outside #515's protein scope
     — **vanilla pods** are the known case (`vanilla seeds` still parses to `2 g`).
   - **Gram yield fed counts** (the INVERSE, introduced by #515's own fix): #515 now
     keeps eggs/egg parts/poultry joints/whole fish as a COUNT (`unit: null`), so a
     form seeded with a **gram** yield no longer reconciles. This is why Recipe C2's
     seeded chicken yields below are now `count`, not the `g` they used to be.

   Rule of thumb: seed the yield in whatever unit the *re-parsed* recipe doc actually
   holds — check the ingredient's `quantity`/`unit` in Firestore first. See finding #2.
4. **AI image generation hangs the recipe view briefly** after first save. If the
   Chrome tab times out, re-navigate to the recipe URL and continue.
5. **Re-canonicalise ≠ re-parse — parser-layer fixes need a re-parse.** Canonicalise
   only re-runs *matching* over the ingredient amounts **already stored** on the recipe
   doc; it never re-parses. So a fix in `parseRecipeIngredients` (e.g. #515, which keeps
   eggs / egg parts / poultry joints / whole fish as a COUNT — `quantity:<n>, unit:null`
   — instead of flattening to grams) is **invisible** if you only wipe canon+forms and
   re-canonicalise: the recipe still holds the pre-fix parse, so a count-yield form fed
   those stale grams can't roll up and you still see `Free Range Egg (350 g)`. To validate
   a parser change you must **re-parse each recipe**: recipe → **Edit** → **Parse from
   text** → paste the ingredient block → **Parse** → **Save**, *then* Canonicalise. Verify
   in Firestore that the eggs now read `quantity:<count>, unit:null` (grams demoted to
   `displayText`, e.g. "about 36g") before trusting the list. This masked #515 on the
   2026-07-15 re-run — the eggs read `350 g` until the recipes were re-parsed, after which
   they rolled up to a parent count (`Free Range Egg ×3` under the then-current MAX rule;
   the same recipes now expect **×4** under #518 — see step 4 and finding #3).
6. **Existing lists do NOT retro-fix themselves — re-add the recipe.** #518's per-form
   demand (`formDemand`) is written at *add-to-list* time. Items already on a list from
   before it predate the field, carry only their collapsed per-recipe count, and take a
   **degrade path that deliberately reproduces the OLD MAX number**. There is no
   migration and none is planned: the field is optional and additive, so old docs stay
   valid, and a list self-heals as soon as its recipes are re-added. **When validating
   #518, delete the shopping-list items and re-add both recipes** — otherwise you will
   see the old numbers and think the fix failed. (A half-re-added list is legitimate and
   mixed: the re-added recipes' demand sums, then maxes against the stale rows' opaque
   counts.)

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
3. Shop → confirm the parent count follows `Σwhole + MAX over forms of (Σ that form)`:
   - **same form, two recipes → SUMS**: `Lime ×5` (zest 10 g + 15 g = 25 g @ 5 g/lime),
     **not** ×3.
   - **distinct forms of one parent → MAX**: `Free Range Egg ×4` = MAX(yolks 2+2, whites 3),
     **not** ×7 and **not** ×3.
   - plain **sum** for non-forms (e.g. `Caster Sugar 250 g`).
4. Cross-check `shoppingLists/<id>/items`: items are stored **per source** (not
   pre-combined); combining is a display concern keyed on `canonId` + unit.
5. Cross-check `formDemand` on each product-form item (the `unit: "count"` rows).
   It should list **every** form of that parent the recipe demanded — including the
   ones collapsed away at write time — each with an **unrounded** `parentCount`:
   ```jsonc
   // recipe B's egg row: collapsed to the MAX (3) for display, but both forms ride along
   { "amount": 3, "unit": "count",
     "formDemand": [ { "formId": "<egg-white form>", "parentCount": 3 },
                     { "formId": "<egg-yolk form>",  "parentCount": 2 } ] }
   ```
   **No `formDemand` on a count row = a pre-#518 item on the degrade path** — it will
   show the old MAX number. Re-add the recipe (gotcha #6) before reporting a bug.

### 5. Reset for a re-run
Delete, via MCP:
- `productForms/*` (all, or just the AI-seeded ones)
- `canonItems/*` (the ones under test)
- `recipes/<id>` (optional)
- `shoppingLists/<id>/items/*` — **required when validating #518.** Stale items carry
  no `formDemand` and will render the OLD MAX numbers via the degrade path, masking
  the fix (gotcha #6).

Then re-run from step 0.

---

## Reference test recipes (used 2026-07-15; expected numbers re-derived for #518)

Quantities are chosen so parent counts differ, making the aggregation observable.
A+B cover both halves of the rule: **Lime** = same form across two recipes (SUMS),
**Free Range Egg** = distinct forms of one parent (MAX, after each form's own sum).
C+D cover the whole/direct-sums-on-top half.

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

Shopping-list checks (A+B), derived from the yields above under the #518 rule:

| Row | Expected | Arithmetic |
|---|---|---|
| **Lime ×5** | ×5 | Zest is ONE form used by both recipes → its demand SUMS: A 10 g + B 15 g = 25 g @ 5 g/lime = **5**. No whole limes. *(Was ×3 pre-#518 — MAX(2,3). This row is the headline regression #518 fixes.)* |
| **Free Range Egg ×4** | ×4 | Two forms of one parent. Yolks are the same form in both recipes → SUM: A 2 + B 2 = 4. Whites: B 3. MAX(4, 3) = **4**. *(Was ×3 pre-#518 — MAX(2,3,2). Not 7: one egg yields both parts.)* |
| **Caster Sugar 250 g** | 250 g | Plain non-form sum: 150 + 100. Unchanged. |
| **Lemon ×3** | ×3 | Only recipe A: 90 ml @ 30 ml/lemon = 3. Single recipe → #518 is a no-op here. |
| **Passion Fruit ×4** | ×4 | Only recipe B: 80 g @ 20 g/fruit = 4. Single recipe → unchanged. |
| ⚠️ **Vanilla Pod** | *no rollup* | `1 tsp vanilla seeds` still parses to grams against a `count` yield → gotcha #3, still open under #513. |

A+B are the cleanest #518 check: **Lime** proves same-form-sums and **Free Range Egg**
proves sum-within-form-then-max-across-forms, in one pair of recipes. Both require the
recipes to be re-parsed (gotcha #5) **and** re-added to the list (gotcha #6).

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
  `productForms` docs pointing at the `Whole Chicken` id, with **count yields**
  (one bird ≈ 2 breasts, 2 thighs):
  ```jsonc
  // productForms/<uuid>
  { "id": "<uuid>", "schemaVersion": 1,
    "matchers": ["chicken breast"], "parentCanonId": "<Whole Chicken id>",
    "label": "Chicken breast",
    "yield": { "formUnit": "count", "amountPerParent": 2 },
    "needs_approval": false, "updatedAt": "<iso>" }
  // thigh: formUnit "count", amountPerParent 2
  ```
  > **Changed from the gram yields (`breast 350 g`, `thigh 240 g`) this runbook used
  > through 2026-07-15.** Those were a workaround for the pre-#515 parser, which
  > flattened `2 chicken breasts` to grams. #515 now keeps poultry joints as a COUNT
  > (`quantity:2, unit:null`), so a gram yield **no longer reconciles and silently
  > stops rolling up** — gotcha #3's inverse. This edit is derived from #515's parser
  > scope, **not** yet re-observed on staging; verify the seeded unit against what the
  > re-parsed recipe doc actually holds.

  Re-canonicalise → tier-1 binds both cuts to Whole Chicken (no AI). Add to list →
  **Whole Chicken ×3** = Σwhole(1) + MAX(breast 1, thigh 2).

  Arithmetic: breasts 2 @ 2/bird = **1**; thighs 4 @ 2/bird = **2**; these are DISTINCT
  forms → MAX(1, 2) = 2. The `1 whole chicken` is the parent as itself → SUMS on top.
  Total **×3**, in ONE `×N` bucket.

  > **Recipe C alone does not exercise #518.** It is a SINGLE recipe, so no form
  > repeats and the sum-per-form step is a no-op — MAX(1,2) is what the old rule gave
  > too. C's number moved from the previously documented `×2` + `"2 count + 1500 g"`
  > purely because of **#515** (the whole chicken now parses as a count and joins the
  > count bucket instead of sitting in a separate `1500 g` bucket), **not** because of
  > #518. To actually test #518 on chicken you need Recipe D.

### Recipe D — "Chicken Thigh Traybake" (add alongside C, for #518)
```
6 chicken thighs
1 tsp smoked paprika
```
Reuses C2's thigh form (tier-1, no AI). 6 thighs @ 2/bird = **3 birds**.

Shopping-list check (C+D): **Whole Chicken ×6**.
Arithmetic: thigh is the SAME form in C and D → its demand SUMS: 2 + 3 = **5**.
Breasts stay **1**. MAX(1, 5) = 5. C's `1 whole chicken` SUMS on top → **6**.
*(Pre-#518 this row would read MAX(1, 2, 3) = 3, +1 whole = 4 — the under-buy.)*

> **Honest note on the #518 issue's headline `Whole Chicken ×5`.** The issue's
> Intended-Experience table describes the staging data as it stood when the issue was
> written, which is **not** identical to these reference recipes. `×5` is
> MAX(breasts 1, thighs 2+3=5) — i.e. the FORM part only, with **no whole-chicken
> line** on the list. Recipe C as documented *does* include `1 whole chicken`, which
> correctly sums on top and makes the honest expected value **×6**. Drop C's
> whole-chicken line and you get exactly ×5. Either way the issue's `thighs 4+6`
> cannot come from recipe C alone (it has 4 thighs, one recipe) — it needs the second
> thigh recipe, which this runbook did not previously document. That gap is why
> Recipe D now exists. See finding #3.

---

## Findings log

- **#1 — cold-canon gate** (GitHub #512). No forms are created when `canonItems`
  is empty; the first recipe's derivatives orphan. One unrelated canon item
  unblocks it. Blocks #505's parent-minting on a truly empty canon. (Never bites
  in prod; canon is never empty.)
- **#2 — count-yield vs gram-amount mismatch** (GitHub #513). Forms whose yield
  unit is `count` don't roll up when the parser stores the recipe amount in grams;
  the list shows raw summed grams and the parent-count rollup is bypassed. Gram-unit
  yields (lime zest 5 g/lime, passion fruit 20 g/fruit) convert and roll up correctly.
  - **Eggs / proteins: FIXED by #515** (merged 2026-07-15). The parser now keeps
    whole eggs, egg parts, poultry joints, and whole fish as a COUNT
    (`quantity:<n>, unit:null`, gram estimate in `displayText`), so the count-yield
    form rolls up to a parent count and combines. Re-validated 2026-07-15:
    `Free Range Egg ×3` = MAX(A yolks 2, B whites 3, B yolks 2) under the then-current
    MAX rule, no longer `350 g`. ⚠️ Only observable **after re-parsing** the recipes —
    see gotcha #5. **Under #518 the same recipes now expect ×4** (yolks 2+2 sum, then
    max against whites 3) — the ×3 above is the superseded number, not a target.
  - **Inverse now possible (from #515's own fix):** a form seeded with a **gram**
    yield stops rolling up for anything in #515's count scope. Recipe C2's chicken
    yields were gram-based and are now documented as `count`. Not yet re-observed on
    staging — see the note on C2.
  - **Still open:** count-yield forms for items *outside* the #515 protein scope —
    e.g. **vanilla pods** (`vanilla seeds` still parses to `2 g`, so the Vanilla Pod
    count-yield form can't roll up). Tracked under #513.
- **#3 — same form across recipes under-bought** (GitHub #518, FIXED). The list
  MAXed already-rounded per-recipe parent counts for every case, including when two
  recipes wanted the **same** form — so `10 g + 15 g` of lime zest bought MAX(2,3) = 3
  limes instead of 25 g = 5. Each form's raw demand was discarded at add time, so the
  display layer could never recover it. Fixed by persisting per-form demand
  (`formDemand`, an UNROUNDED fractional parent-count per form) on the shopping item
  and aggregating `Σwhole + MAX over forms of (Σ that form's demand)`, rounding once
  on the sum. Distinct forms still MAX (one egg yields both parts) and whole/direct
  still sums on top — those halves are unchanged.
  - **Back-compat / no migration:** items written before #518 have no `formDemand`
    and take a degrade path reproducing the old MAX number exactly. Lists self-heal
    when recipes are re-added — see gotcha #6. This is the most likely reason a
    staging run "fails": stale list items, not a broken rule.
  - **Runbook coverage gap this exposed:** the reference recipes could only
    demonstrate #518 on **Lime** and **Free Range Egg** (A+B). Recipe C is a single
    recipe, so its forms never repeat and its number is unchanged by #518 — the
    issue's `Whole Chicken ×5 / thighs 4+6` headline cannot come from C alone.
    **Recipe D** was added to supply the second thigh recipe; C+D expect **×6**
    (×5 of forms + C's 1 whole chicken). Do not "fix" C+D to ×5 — see Recipe D's note.
  - The contract (both halves, the round-once rule, the degrade path, and schema
    back-compat) is locked in CI: `packages/domain/tests/productForm/aggregateParentCount.test.ts`,
    `tests/shoppingList/groupItemsByAisle.test.ts`, `tests/shoppingList/shoppingListItem.schema.test.ts`.
