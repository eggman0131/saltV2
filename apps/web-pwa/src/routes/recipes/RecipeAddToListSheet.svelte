<script lang="ts">
  import {
    Button,
    Checkbox,
    Icon,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
  } from '@salt/ui-components';
  import { titleCase } from '../../lib/titleCase.js';
  import type { Recipe } from '@salt/domain';
  import {
    buildRecipeAddPlan,
    buildMadeSubRows,
    commitRecipeAddPlan,
    recipeAddPlanItemCount,
    type RecipeAddRow,
  } from '../../lib/recipeService.js';
  import { canonItems } from '../../lib/canonService.js';
  import { addToast } from '../../lib/toastStore.js';

  interface Props {
    recipe: Recipe;
    listId: string;
    open: boolean;
  }
  let { recipe, listId, open = $bindable() }: Props = $props();

  let selectedServings = $state(1);
  let rows = $state<RecipeAddRow[]>([]);
  let busy = $state(false);

  // Rebuild the plan whenever the sheet opens, servings change, or the canon
  // snapshot changes — this reseeds the Add/Check toggles from the defaults and
  // discards any prior adjustments (servings changes the amounts and thresholds).
  $effect(() => {
    if (!open) return;
    void $canonItems; // establish reactivity on the canon snapshot
    rows = buildRecipeAddPlan(recipe, selectedServings);
  });

  // Seed servings from the recipe each time the sheet opens.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) selectedServings = recipe.metadata.servings ?? 1;
    wasOpen = open;
  });

  // What the confirm will actually write: a Make row counts its producer's
  // fanned-out ingredients, not 1. Derived so it tracks Buy/Make + producer-picker
  // toggles. See recipeAddPlanItemCount.
  const addCount = $derived(recipeAddPlanItemCount(rows));

  function rowLabel(row: RecipeAddRow): string {
    return row.fromCanon ? titleCase(row.name) : row.name;
  }

  function amountLabel(row: RecipeAddRow): string | null {
    if (row.amount === undefined) return null;
    return row.unit ? `${row.amount} ${row.unit}` : `${row.amount}`;
  }

  function setAdd(row: RecipeAddRow, value: boolean): void {
    row.add = value;
    // Check implies Add — drop the verification flag when an item leaves the list.
    if (!value) row.check = false;
  }

  function setCheck(row: RecipeAddRow, value: boolean): void {
    row.check = value;
    // Check implies Add — selecting Check pulls the item onto the list.
    if (value) row.add = true;
  }

  // Buy-or-make. Choosing Make turns the row into a label-only header and builds
  // the chosen producer's ingredients EAGERLY as nested, individually-toggleable
  // sub-entries (each seeded exactly like a master-recipe row). Flipping back to
  // Buy collapses to the single ordinary line. Make implies Add so an eligible
  // row can't be "made" yet left off the list.
  function setMake(row: RecipeAddRow, value: boolean): void {
    row.make = value;
    if (value) {
      row.add = true;
      // (Re)default the made-header servings to the selected producer's OWN base
      // each time Make is entered — never carried from the master recipe or a
      // prior producer/toggle. Independent of the master stepper.
      row.madeServings = producerBase(row);
      row.subRows = buildMadeSubRows(row);
    } else {
      row.subRows = null;
    }
  }

  // The currently-selected producer's own base servings (`metadata.servings ?? 1`),
  // used to (re)default the per-header stepper. 1 when nothing is resolvable.
  function producerBase(row: RecipeAddRow): number {
    return (
      (row.producers.find((r) => r.id === row.producerId) ?? row.producers[0])?.metadata.servings ??
      1
    );
  }

  // When the chosen producer changes, reset the per-header servings to the NEW
  // producer's base and rebuild the nested sub-entries so amounts + count reflect
  // that producer at its own base batch.
  function setProducer(row: RecipeAddRow, producerId: string): void {
    row.producerId = producerId;
    row.madeServings = producerBase(row);
    if (row.make) row.subRows = buildMadeSubRows(row);
  }

  // Step a made header's servings (min 1) and live-rescale its sub-entries. Fully
  // independent of the master `selectedServings` stepper: this only rebuilds the
  // header's own `subRows` at the new batch size — the master row amounts and
  // every other row are untouched.
  function setMadeServings(row: RecipeAddRow, value: number): void {
    row.madeServings = Math.max(1, value);
    if (row.make) row.subRows = buildMadeSubRows(row);
  }

  function producerLabel(row: RecipeAddRow): string {
    return row.producers.find((r) => r.id === row.producerId)?.title ?? 'recipe';
  }

  async function handleConfirm(): Promise<void> {
    busy = true;
    const result = await commitRecipeAddPlan(recipe, listId, selectedServings, rows);
    busy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to add to shopping list.', 'destructive');
      return;
    }
    open = false;
    addToast(
      addCount === 0
        ? 'Nothing added to the list.'
        : `Added ${addCount} item${addCount === 1 ? '' : 's'} to the list.`,
      'success',
    );
  }
</script>

<Sheet
  bind:open
  side="bottom"
  onOpenChange={(v) => {
    if (!v) busy = false;
  }}
>
  <SheetContent class="flex max-h-[85vh] flex-col gap-4 p-4 pb-8">
    <SheetHeader>
      <SheetTitle>Add to shopping list</SheetTitle>
    </SheetHeader>

    <!-- Servings -->
    <div class="flex items-center justify-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onclick={() => (selectedServings = Math.max(1, selectedServings - 1))}
        disabled={selectedServings <= 1 || busy}
        aria-label="Decrease servings"
        data-testid="recipe-servings-decrease"
      >
        <Icon name="Minus" size={14} />
      </Button>
      <span
        class="min-w-[3rem] text-center text-sm font-medium"
        data-testid="recipe-servings-value"
      >
        {selectedServings} serving{selectedServings === 1 ? '' : 's'}
      </span>
      <Button
        variant="outline"
        size="sm"
        onclick={() => (selectedServings = selectedServings + 1)}
        disabled={busy}
        aria-label="Increase servings"
        data-testid="recipe-servings-increase"
      >
        <Icon name="Plus" size={14} />
      </Button>
    </div>

    <!-- Ingredient toggles -->
    <div class="flex flex-col gap-1 overflow-y-auto" data-testid="recipe-add-review-list">
      <div
        class="flex items-center gap-2 px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <span class="flex-1">Ingredient</span>
        <span class="w-12 text-center">Add</span>
        <span class="w-12 text-center">Check</span>
      </div>
      {#each rows as row (row.ingredientId)}
        <div
          class="rounded border border-border text-sm"
          data-testid="recipe-add-review-row"
          data-ingredient-id={row.ingredientId}
        >
          <!-- Top line: the ingredient. When Made it becomes a label-only header
               and its Add/Check toggles move to the nested sub-entries below. -->
          <div class="flex items-center gap-2 px-3 py-2">
            <div class="flex-1 min-w-0">
              <span class="block truncate">
                {rowLabel(row)}
                <!-- Suppress the required amount on a made header: it's label-only
                     (the sub-entries carry their own amounts), so showing it here
                     misleads. -->
                {#if amountLabel(row) && !row.make}<span class="text-muted-foreground"
                    >({amountLabel(row)})</span
                  >{/if}
                {#if row.isOptional}<span class="text-xs text-muted-foreground">(optional)</span
                  >{/if}
              </span>
              <!-- A product-form row is labelled with the PARENT product ("Lime"),
                   which deliberately reads nothing like the recipe's own line, and
                   a collapsed row mentions neither of the lines that justified its
                   count. Show the original wording alongside the label so the
                   reviewer can see what the count is for. Sibling of the truncating
                   label span — inside it these would be clipped. -->
              {#if row.originalText}
                {#each row.originalText as line (line)}
                  <span
                    class="block text-xs text-muted-foreground"
                    data-testid="recipe-add-review-original-text">{line}</span
                  >
                {/each}
              {/if}
              {#if row.producers.length > 0}
                <!-- Buy-or-make: eligible rows only. Default Buy — identical to the
                     single-item add. Make expands the chosen producing recipe's
                     ingredients as nested, individually-toggleable sub-entries. -->
                <div class="mt-1 flex items-center gap-2" data-testid="recipe-add-review-buymake">
                  <div class="inline-flex gap-1">
                    <Button
                      size="sm"
                      variant={row.make ? 'outline' : 'solid'}
                      class="h-6 px-2 text-xs"
                      onclick={() => setMake(row, false)}
                      aria-pressed={!row.make}
                      aria-label="Buy {rowLabel(row)}"
                      data-testid="recipe-add-review-buy"
                    >
                      Buy
                    </Button>
                    <Button
                      size="sm"
                      variant={row.make ? 'solid' : 'outline'}
                      class="h-6 px-2 text-xs"
                      onclick={() => setMake(row, true)}
                      aria-pressed={row.make}
                      aria-label="Make {rowLabel(row)}"
                      data-testid="recipe-add-review-make"
                    >
                      Make
                    </Button>
                  </div>
                  {#if row.make && row.producers.length > 1}
                    <!-- Mini-picker: which producing recipe to make (multiple candidates).
                         Changing it rebuilds the nested sub-entries. -->
                    <Select value={row.producerId ?? ''} onValueChange={(v) => setProducer(row, v)}>
                      <SelectTrigger
                        class="h-6 max-w-[10rem] shrink text-xs"
                        data-testid="recipe-add-review-producer"
                      >
                        <span class="truncate">{producerLabel(row)}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {#each row.producers as p (p.id)}
                          <SelectItem value={p.id}>{p.title}</SelectItem>
                        {/each}
                      </SelectContent>
                    </Select>
                  {/if}
                </div>
                {#if row.make}
                  <!-- Per-header servings stepper (Phase 2). Mirrors the master
                       stepper (recipe-servings-*) but is scoped to THIS made header
                       (the parent row carries data-ingredient-id). Defaults to the
                       producer's own base; stepping it live-rescales the sub-entry
                       amounts below and the committed quantities. Independent of the
                       master servings stepper. -->
                  <div class="mt-1 flex items-center gap-2" data-testid="recipe-add-made-servings">
                    <span class="text-xs text-muted-foreground">Makes</span>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-6 px-2"
                      onclick={() => setMadeServings(row, row.madeServings - 1)}
                      disabled={row.madeServings <= 1 || busy}
                      aria-label="Decrease servings for {rowLabel(row)}"
                      data-testid="recipe-add-made-servings-decrease"
                    >
                      <Icon name="Minus" size={12} />
                    </Button>
                    <span
                      class="min-w-[3rem] text-center text-xs font-medium"
                      data-testid="recipe-add-made-servings-value"
                    >
                      {row.madeServings} serving{row.madeServings === 1 ? '' : 's'}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-6 px-2"
                      onclick={() => setMadeServings(row, row.madeServings + 1)}
                      disabled={busy}
                      aria-label="Increase servings for {rowLabel(row)}"
                      data-testid="recipe-add-made-servings-increase"
                    >
                      <Icon name="Plus" size={12} />
                    </Button>
                  </div>
                {/if}
              {/if}
            </div>
            <!-- A made header emits no item of its own → no Add/Check toggles. -->
            {#if !row.make}
              <div class="flex w-12 justify-center">
                <Checkbox
                  checked={row.add}
                  onCheckedChange={(v) => setAdd(row, v === true)}
                  aria-label="Add {rowLabel(row)}"
                  data-testid="recipe-add-review-add"
                />
              </div>
              <div class="flex w-12 justify-center">
                <Checkbox
                  checked={row.check}
                  onCheckedChange={(v) => setCheck(row, v === true)}
                  aria-label="Check {rowLabel(row)}"
                  data-testid="recipe-add-review-check"
                />
              </div>
            {/if}
          </div>

          <!-- Nested sub-entries for a Made row: the producer's ingredients scaled
               to the header's chosen servings (Phase 2), each independently
               add/check-able. -->

          {#if row.make && row.subRows}
            <div
              class="flex flex-col gap-1 border-t border-border/60 py-2 pl-6 pr-3"
              data-testid="recipe-add-review-subrows"
            >
              {#each row.subRows as sub (sub.ingredientId)}
                <div
                  class="flex items-center gap-2"
                  data-testid="recipe-add-review-subrow"
                  data-ingredient-id={sub.ingredientId}
                >
                  <div class="flex-1 min-w-0">
                    <span class="block truncate">
                      {rowLabel(sub)}
                      {#if amountLabel(sub)}<span class="text-muted-foreground"
                          >({amountLabel(sub)})</span
                        >{/if}
                      {#if sub.isOptional}<span class="text-xs text-muted-foreground"
                          >(optional)</span
                        >{/if}
                    </span>
                    <!-- Same terms as a top-level row: a made producer's own
                         ingredients collapse identically (buildMadeSubRows spreads
                         the plan's rows), so a sub-entry needs the same wording. -->
                    {#if sub.originalText}
                      {#each sub.originalText as line (line)}
                        <span
                          class="block text-xs text-muted-foreground"
                          data-testid="recipe-add-review-original-text">{line}</span
                        >
                      {/each}
                    {/if}
                  </div>
                  <div class="flex w-12 justify-center">
                    <Checkbox
                      checked={sub.add}
                      onCheckedChange={(v) => setAdd(sub, v === true)}
                      aria-label="Add {rowLabel(sub)}"
                      data-testid="recipe-add-review-subrow-add"
                    />
                  </div>
                  <div class="flex w-12 justify-center">
                    <Checkbox
                      checked={sub.check}
                      onCheckedChange={(v) => setCheck(sub, v === true)}
                      aria-label="Check {rowLabel(sub)}"
                      data-testid="recipe-add-review-subrow-check"
                    />
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <SheetFooter class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={busy}
        >Cancel</Button
      >
      <Button
        size="sm"
        onclick={handleConfirm}
        loading={busy}
        disabled={busy}
        data-testid="recipe-add-to-list-confirm"
      >
        Add {addCount} to list
      </Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
