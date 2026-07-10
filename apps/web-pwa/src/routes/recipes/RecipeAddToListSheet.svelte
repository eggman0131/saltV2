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

  // Buy-or-make (Phase 2). Choosing Make fans out the chosen producing recipe's
  // ingredients on commit; Make implies Add so an eligible row can't be "made" yet
  // left off the list.
  function setMake(row: RecipeAddRow, value: boolean): void {
    row.make = value;
    if (value) row.add = true;
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
          class="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm"
          data-testid="recipe-add-review-row"
          data-ingredient-id={row.ingredientId}
        >
          <div class="flex-1 min-w-0">
            <span class="block truncate">
              {rowLabel(row)}
              <!-- Suppress the parent's required amount in Make mode: Make ignores
                   it (a full producer batch is fanned out), so showing it misleads. -->
              {#if amountLabel(row) && !row.make}<span class="text-muted-foreground"
                  >({amountLabel(row)})</span
                >{/if}
              {#if row.isOptional}<span class="text-xs text-muted-foreground">(optional)</span>{/if}
            </span>
            {#if row.producers.length > 0}
              <!-- Buy-or-make (Phase 2): eligible rows only. Default Buy — Buy is
                   identical to the pre-Phase-2 single-item add. Make fans out the
                   chosen producing recipe's ingredients on commit. -->
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
                  <!-- Mini-picker: which producing recipe to make (multiple candidates). -->
                  <Select value={row.producerId ?? ''} onValueChange={(v) => (row.producerId = v)}>
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
            {/if}
          </div>
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
