<script lang="ts">
  import { untrack } from 'svelte';
  import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Checkbox,
    DetailPage,
    EmptyState,
    Icon,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Spinner,
    TextField,
  } from '@salt/ui-components';
  import { goBack } from '../../lib/nav.js';
  import { recipes, isLoadingRecipes } from '../../lib/recipeService.js';
  import { canonItems } from '../../lib/canonService.js';
  import {
    formula as storedFormula,
    initFormulaSync,
    saveFormula,
  } from '../../lib/formulaService.js';
  import {
    UNIT_SHAPE_PRESETS,
    deriveFormula,
    flattenIngredients,
    gramsFromParsed,
    guessBasisIngredientIds,
    roundGrams,
    takesIngredients,
    targetYield,
    unitShapeFromPreset,
    unitShapePreset,
  } from '@salt/domain';
  import type { Ingredient } from '@salt/domain';
  import type { Formula, FormulaComponent } from '@salt/domain/schemas';
  import { kindOf } from './recipeKind.js';
  import { addToast } from '../../lib/toastStore.js';

  // The formula screen (issue #806, phase 1 of epic #778) — `/recipes/:id/formula`.
  //
  // An ordinary AppShell route, deliberately NOT full-viewport: this is desk work
  // done once a month, not a hands-full mode. It is reachable BY URL ONLY — the
  // recipe page gains nothing in this phase, so opening a loaf is indistinguishable
  // from opening any other dish.
  //
  // What it is FOR: turning a recipe's grams into baker's percentages against a
  // declared basis, with a human confirming the two things the machine cannot know
  // — which ingredients ARE the basis, and what a count-based line weighs.
  //
  // THE RECIPE IS NEVER TOUCHED. Nothing here writes `recipes`, and no quantity is
  // ever shown at any yield other than as-written: the only two figures on screen
  // beyond the recipe's own are the dough total (the recipe's own arithmetic) and
  // the declared shape (what the user just said). Scaled quantities belong to the
  // batch, phase 02.

  let { params }: { params?: { id?: string } } = $props();

  const recipeId = $derived(params?.id ?? '');
  const recipe = $derived($recipes.find((r) => r.id === recipeId) ?? null);
  const ingredients = $derived(recipe ? flattenIngredients(recipe) : []);

  // Canon supplies the tidy name a flour guess reads best from ("strong white
  // flour", not "500g strong white bread flour, plus extra for dusting"). Domain
  // never sees the store: the ids are resolved HERE and the already-resolved text
  // is what crosses the boundary.
  const canonNameById = $derived(new Map($canonItems.map((c) => [c.id, c.name])));

  // Subscribe to this recipe's formula for as long as the page is open. Re-runs
  // when the id changes; the service resets its store on every init so a formula
  // from a previous recipe can never be shown against this one.
  $effect(() => {
    if (!recipeId) return;
    return initFormulaSync(recipeId);
  });

  // ─── The working model ────────────────────────────────────────────────────────
  //
  // A GRAM LIST, deliberately — not a percentage list. `deriveFormula` is the only
  // maths on this page, and one code path covers all four interactions: the initial
  // derive, a basis toggle, a hand-typed weight and an exclusion. There is no
  // second "rebase the percentages" function anywhere, because there is nothing for
  // one to do.
  //
  // `gramsText` is the RAW STRING being typed, for the same reason GuidedPlanPage
  // keeps a check-in's minutes as a string: re-rendering the box from a parsed
  // number means clearing it to type a new figure snaps it back to the old one.
  interface Row {
    ingredientId: string;
    rawText: string;
    // What the recipe itself says this weighs, or null for a count-based line
    // ("2 eggs") and for anything with no amount at all ("a pinch"). The anchor
    // every displayed gram figure is pinned to — see `anchorBasisGrams`.
    recipeGrams: number | null;
    // The recipe gave a range and the midpoint was taken. Disclosed on screen,
    // because this screen is the only moment anyone can object: once the range is a
    // percentage it is gone for good.
    isRange: boolean;
    gramsText: string;
    included: boolean;
    inBasis: boolean;
  }

  let rows = $state<Row[]>([]);
  let presetId = $state('');
  let countText = $state('1');
  // Whether the working model holds changes the stored document does not. Guards
  // the re-seed below: an incoming snapshot never overwrites work in progress.
  let dirty = $state(false);
  let saving = $state(false);

  function parseGrams(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    const value = Number(trimmed);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function gramsOf(row: Row): number | null {
    return parseGrams(row.gramsText);
  }

  // ─── Seeding ──────────────────────────────────────────────────────────────────

  /**
   * The scale that puts a STORED formula back into the recipe's own grams.
   *
   * The document holds percentages and no gram figure at all (by design — grams and
   * percent stored side by side would drift). To repopulate the boxes we need one
   * component whose weight we independently know, and the recipe supplies exactly
   * that for every line it gave an amount for. From one such pairing the whole basis
   * weight follows, and every other component — including a hand-typed "2 eggs →
   * 100 g", which the recipe knows nothing about — comes back with it.
   *
   * A basis member is preferred simply because it is the least likely to have been
   * hand-entered. Null when no component has both a recipe weight and a percentage:
   * a formula built entirely by hand, where the honest fallback is the recipe's own
   * figures and a blank box for the rest.
   */
  function anchorBasisGrams(
    components: readonly FormulaComponent[],
    recipeGramsById: ReadonlyMap<string, number | null>,
  ): number | null {
    const basisFirst = [...components].sort((a, b) => Number(b.inBasis) - Number(a.inBasis));
    for (const component of basisFirst) {
      const grams = recipeGramsById.get(component.ingredientId);
      if (grams != null && component.percent > 0) return grams / (component.percent / 100);
    }
    return null;
  }

  function seed(stored: Formula | null, ings: readonly Ingredient[]): void {
    const guessed = new Set(
      guessBasisIngredientIds(
        ings.map((ing) => ({
          ingredientId: ing.id,
          canonName: (ing.canonId ? canonNameById.get(ing.canonId) : null) ?? null,
          rawText: ing.rawText,
        })),
      ),
    );
    const recipeGramsById = new Map(ings.map((ing) => [ing.id, gramsFromParsed(ing.parsed)]));
    const storedById = new Map((stored?.components ?? []).map((c) => [c.ingredientId, c]));
    const anchor = stored ? anchorBasisGrams(stored.components, recipeGramsById) : null;

    rows = ings.map((ing) => {
      const recipeGrams = recipeGramsById.get(ing.id) ?? null;
      const component = storedById.get(ing.id);
      const recovered =
        component && anchor !== null ? roundGrams(anchor * (component.percent / 100)) : null;
      const grams = stored ? (recovered ?? recipeGrams) : recipeGrams;
      return {
        ingredientId: ing.id,
        rawText: ing.rawText,
        recipeGrams,
        isRange: ing.parsed?.quantity?.type === 'range',
        gramsText: grams === null ? '' : String(grams),
        // First visit: an ingredient is in if the recipe weighed it. Revisit: it is
        // in if the stored formula named it, which is what preserves both a
        // hand-typed weight and a deliberate exclusion across a reload.
        included: stored ? component !== undefined && grams !== null : grams !== null,
        inBasis: stored ? (component?.inBasis ?? false) : guessed.has(ing.id),
      };
    });

    if (stored?.referenceYield.kind === 'target') {
      const shape = stored.referenceYield.shape;
      const preset = UNIT_SHAPE_PRESETS.find(
        (p) => p.label === shape.label && p.unitDoughGrams === shape.unitDoughGrams,
      );
      presetId = preset?.id ?? '';
      countText = String(shape.count);
    } else {
      presetId = '';
      countText = '1';
    }
    dirty = false;
  }

  // What the rows were last taken from. Identity, not a version stamp: the formula
  // document carries no timestamps (deliberately — there is nothing to order), so
  // "have I already seeded from this?" is answered by object identity on the three
  // inputs a seed reads. The early return is what stops the effect looping, since
  // `seed` writes state the effect reads.
  let lastSeeded: {
    recipeId: string;
    stored: Formula | null;
    ings: readonly Ingredient[];
    canon: ReadonlyMap<string, string>;
  } | null = null;

  $effect(() => {
    const stored = $storedFormula;
    const ings = ingredients;
    const canon = canonNameById;
    const id = recipeId;
    if (stored === undefined || !id) return; // still loading — nothing to seed from
    untrack(() => {
      const previous = lastSeeded;
      if (
        previous !== null &&
        previous.recipeId === id &&
        previous.stored === stored &&
        previous.ings === ings &&
        previous.canon === canon
      ) {
        return;
      }
      const next = { recipeId: id, stored, ings, canon };
      // Unsaved work on THIS recipe wins over an incoming snapshot — the same
      // answer every other surface gives under LWW. A different recipe always
      // re-seeds: those edits belong somewhere else.
      if (dirty && previous?.recipeId === id) {
        lastSeeded = next;
        return;
      }
      seed(stored, ings);
      lastSeeded = next;
    });
  });

  // ─── Interactions ─────────────────────────────────────────────────────────────

  function touch(): void {
    dirty = true;
  }

  function patchRow(ingredientId: string, patch: Partial<Row>): void {
    rows = rows.map((r) => (r.ingredientId === ingredientId ? { ...r, ...patch } : r));
    touch();
  }

  // Typing a weight puts a row IN; clearing the box takes it out. One rule, no
  // hidden flag: the checkbox is an explicit override that holds until the weight
  // changes again. This is what makes "2 eggs" work — the prompt is the empty box,
  // and leaving it empty is how you leave the eggs out.
  function setGrams(ingredientId: string, text: string): void {
    patchRow(ingredientId, { gramsText: text, included: parseGrams(text) !== null });
  }

  function setIncluded(ingredientId: string, included: boolean): void {
    patchRow(ingredientId, { included });
  }

  function setInBasis(ingredientId: string, inBasis: boolean): void {
    patchRow(ingredientId, { inBasis });
  }

  // ─── The one piece of maths ───────────────────────────────────────────────────

  const componentInputs = $derived(
    rows.flatMap((row) => {
      const grams = gramsOf(row);
      return row.included && grams !== null
        ? [{ ingredientId: row.ingredientId, grams, inBasis: row.inBasis }]
        : [];
    }),
  );

  const selectedPreset = $derived(presetId ? unitShapePreset(presetId) : null);
  const count = $derived.by(() => {
    const value = Number(countText.trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const shape = $derived(
    selectedPreset && count !== null ? unitShapeFromPreset(selectedPreset, count) : null,
  );

  // Recalculated on EVERY change — a basis toggle, a typed gram, an exclusion. That
  // is the point of holding grams rather than percentages: there is one function,
  // and it is the one that wrote the document in the first place.
  const derivation = $derived(
    deriveFormula({
      recipeId,
      components: componentInputs,
      ...(shape ? { referenceYield: targetYield(shape) } : {}),
    }),
  );

  const percentById = $derived(
    derivation.ok
      ? new Map(derivation.formula.components.map((c) => [c.ingredientId, c.percent]))
      : new Map<string, number>(),
  );

  // Stored at four decimals (`roundPercent`), shown at one: yeast reads 1.4% and
  // flour reads 100%, not 100.0%.
  function formatPercent(percent: number | undefined): string {
    if (percent === undefined) return '—';
    const text = percent.toFixed(1);
    return `${text.endsWith('.0') ? text.slice(0, -2) : text}%`;
  }

  function formatGrams(grams: number): string {
    return `${roundGrams(grams)} g`;
  }

  // ─── The two disclosures ──────────────────────────────────────────────────────
  //
  // Both are places information is lost or asserted, and both are stated plainly
  // because this screen is the only moment anyone can object.

  // The recipe's OWN arithmetic — everything included, added up as written. Not a
  // scaled quantity and not a projection: it is the sum of the numbers already on
  // the page.
  const asWrittenDoughGrams = $derived(
    componentInputs.reduce((sum, component) => sum + component.grams, 0),
  );
  const declaredDoughGrams = $derived(shape ? shape.count * shape.unitDoughGrams : null);
  // A declaration re-anchors the formula. 500 g of flour at a 176.4% grand total is
  // 882 g of dough, so calling it one 900 g tin loaf moves everything by ~2% — small
  // and entirely reasonable, but it should be visible rather than silent.
  const declarationDriftPercent = $derived(
    declaredDoughGrams !== null && asWrittenDoughGrams > 0
      ? ((declaredDoughGrams - asWrittenDoughGrams) / asWrittenDoughGrams) * 100
      : null,
  );

  const rangeRows = $derived(rows.filter((row) => row.isRange && row.included));

  // ─── Save ─────────────────────────────────────────────────────────────────────

  // A declaration is REQUIRED. Without one the formula has no reference yield worth
  // the name, and phase 02 would have nothing to solve a batch against.
  const canSave = $derived(shape !== null && derivation.ok && !saving);

  const blockedReason = $derived.by(() => {
    if (shape === null) return 'Say what this makes before saving.';
    if (!derivation.ok) {
      switch (derivation.reason.kind) {
        case 'emptyFormula':
          return 'Nothing is in the formula yet — give at least one ingredient a weight.';
        case 'noBasis':
          return 'Nothing is in the basis. Tick the flours (or whatever the 100% is).';
        default:
          return 'This formula does not add up yet.';
      }
    }
    return null;
  });

  async function handleSave(): Promise<void> {
    if (!canSave || !derivation.ok) return;
    saving = true;
    const result = await saveFormula(derivation.formula);
    saving = false;
    if (result.kind !== 'ok') {
      addToast("Couldn't save the formula.", 'destructive');
      return;
    }
    // The store now holds what was written, so let the incoming snapshot re-seed:
    // it exercises the same recovery path a reload takes, in front of the user.
    dirty = false;
    addToast('Formula saved.', 'success');
  }

  const loading = $derived($isLoadingRecipes || $storedFormula === undefined);
</script>

{#if loading}
  <div class="flex justify-center p-8"><Spinner /></div>
{:else if !recipe}
  <div class="p-6">
    <EmptyState title="Recipe not found" description="It may have been deleted." />
  </div>
{:else if !takesIngredients(kindOf(recipe))}
  <!-- Capability-gated, never kind-gated (CLAUDE.md): a formula is composition, so
       an entry with no ingredients has no composition to express. Reachable only by
       typing the URL — nothing in the app offers this route. -->
  <div class="p-6">
    <EmptyState
      title="Nothing to weigh here"
      description="A formula is a recipe's ingredients as percentages, and this entry doesn't have any."
    />
  </div>
{:else}
  <DetailPage
    title="Formula"
    subtitle={recipe.title}
    onBack={() => goBack(`/recipes/${recipe.id}`)}
    backLabel="Back"
    class="p-4 sm:p-6"
  >
    {#snippet actions()}
      <Button
        size="sm"
        onclick={handleSave}
        loading={saving}
        disabled={!canSave}
        data-testid="formula-save-button"
      >
        {#snippet leading()}<Icon name="Check" size={16} />{/snippet}
        Save
      </Button>
    {/snippet}

    <div class="flex flex-col gap-4" data-testid="formula-editor">
      {#if ingredients.length === 0}
        <EmptyState
          title="No ingredients yet"
          description="Add the ingredients to the recipe and they'll show up here to weigh."
        />
      {:else}
        <!-- ─── The basis and the percentages ──────────────────────────────── -->
        <Card>
          <CardHeader>
            <CardTitle>Ingredients</CardTitle>
          </CardHeader>
          <CardContent class="flex flex-col gap-3">
            <p class="text-sm text-muted-foreground">
              The basis is the 100%. For bread that's the flours: everything else is a percentage of
              them.
            </p>
            {#each rows as row (row.ingredientId)}
              <div
                role="group"
                aria-label={row.rawText}
                class="flex flex-col gap-2 rounded border p-3"
                class:opacity-60={!row.included}
                data-testid="formula-row"
              >
                <div class="flex items-start justify-between gap-3">
                  <span class="flex-1 text-sm">{row.rawText}</span>
                  <span
                    class="text-sm font-medium tabular-nums"
                    class:text-muted-foreground={!row.inBasis}
                    data-testid="formula-row-percent"
                  >
                    {formatPercent(percentById.get(row.ingredientId))}
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-4">
                  <TextField
                    label="Weight (g)"
                    inputmode="decimal"
                    class="w-32"
                    placeholder={row.recipeGrams === null ? 'e.g. 100' : ''}
                    value={row.gramsText}
                    onValueChange={(v) => setGrams(row.ingredientId, v)}
                    data-testid="formula-row-grams"
                  />
                  <Checkbox
                    label="In the basis"
                    checked={row.inBasis}
                    disabled={!row.included}
                    onCheckedChange={(v) => setInBasis(row.ingredientId, v === true)}
                    data-testid="formula-row-basis"
                  />
                  <Checkbox
                    label="Include"
                    checked={row.included}
                    disabled={gramsOf(row) === null}
                    onCheckedChange={(v) => setIncluded(row.ingredientId, v === true)}
                    data-testid="formula-row-include"
                  />
                </div>
                {#if row.recipeGrams === null}
                  <!-- Count-based ("2 eggs") or no amount at all ("a pinch"). Domain
                       will not guess what an egg weighs — that would be a second
                       scaling mechanism hidden behind a constant — so the weight is
                       asked for here, or the line is left out of the formula. -->
                  <p class="text-xs text-muted-foreground" data-testid="formula-row-needs-grams">
                    The recipe doesn't weigh this one. Give it a weight in grams, or leave it out.
                  </p>
                {/if}
              </div>
            {/each}
          </CardContent>
        </Card>

        {#if rangeRows.length > 0}
          <!-- DISCLOSURE ONE. A range becomes a point value the moment it becomes a
               percentage, and a batch will later print a confident figure the recipe
               never gave. This is the only moment anyone can object. -->
          <div
            class="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 px-3 py-3"
            data-testid="formula-range-disclosure"
          >
            <p class="text-sm text-amber-900">
              {rangeRows.length === 1 ? 'One ingredient is' : `${rangeRows.length} ingredients are`}
              given as a range. The midpoint is what the formula keeps — the range itself is gone once
              this is saved.
            </p>
            {#each rangeRows as row (row.ingredientId)}
              {@const grams = gramsOf(row)}
              <p class="text-sm text-amber-900">
                <span class="font-medium">{row.rawText}</span>
                — taken as {grams === null ? 'its midpoint' : formatGrams(grams)}
              </p>
            {/each}
          </div>
        {/if}

        <!-- ─── What it makes ──────────────────────────────────────────────── -->
        <Card>
          <CardHeader>
            <CardTitle>What this makes</CardTitle>
          </CardHeader>
          <CardContent class="flex flex-col gap-3">
            <div class="flex flex-wrap items-end gap-3">
              <TextField
                label="How many"
                inputmode="numeric"
                class="w-28"
                value={countText}
                onValueChange={(v) => {
                  countText = v;
                  touch();
                }}
                data-testid="formula-count"
              />
              <!-- Presets only, no free-text shape: a custom shape would also need a
                   bake loss, and nobody can be asked for a figure they have no way
                   to know. The list is domain data and can grow there. -->
              <Select
                value={presetId}
                onValueChange={(v) => {
                  presetId = v;
                  touch();
                }}
              >
                <SelectTrigger
                  class="w-56"
                  aria-label="What this makes"
                  data-testid="formula-shape-select"
                >
                  {selectedPreset?.label ?? 'Pick a shape…'}
                </SelectTrigger>
                <SelectContent>
                  {#each UNIT_SHAPE_PRESETS as preset (preset.id)}
                    <SelectItem value={preset.id}>{preset.label}</SelectItem>
                  {/each}
                </SelectContent>
              </Select>
            </div>

            <!-- DISCLOSURE TWO. The recipe's own dough total sits next to the one
                 just declared, so re-anchoring the formula is visible rather than
                 silent. Neither number is a scaled quantity: the first is the sum of
                 the weights on this page and the second is what the user just said.
                 -->
            <div class="text-sm" data-testid="formula-dough-total">
              <p>
                As written, this weighs
                <span class="font-medium">{formatGrams(asWrittenDoughGrams)}</span> of dough.
              </p>
              {#if declaredDoughGrams !== null && shape !== null}
                <p>
                  You've declared {shape.count} × {shape.label} —
                  <span class="font-medium">{formatGrams(declaredDoughGrams)}</span>.
                </p>
                {#if declarationDriftPercent !== null && Math.abs(declarationDriftPercent) >= 0.5}
                  <p class="text-muted-foreground" data-testid="formula-declaration-drift">
                    That re-anchors the formula by {declarationDriftPercent > 0
                      ? '+'
                      : ''}{declarationDriftPercent.toFixed(1)}%. The percentages don't change; what
                    a batch weighs out does.
                  </p>
                {/if}
              {/if}
            </div>
          </CardContent>
        </Card>

        {#if blockedReason}
          <p class="text-sm text-muted-foreground" data-testid="formula-blocked-reason">
            {blockedReason}
          </p>
        {/if}
      {/if}
    </div>
  </DetailPage>
{/if}
