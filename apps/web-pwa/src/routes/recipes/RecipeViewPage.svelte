<script lang="ts">
  import {
    Button,
    DetailPage,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Icon,
    Popover,
    PopoverTrigger,
    PopoverContent,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    recipes,
    isLoadingRecipes,
    removeRecipe,
    canonicaliseIngredients,
    addRecipeToShoppingList,
  } from '../../lib/recipeService.js';
  import { canonItems } from '../../lib/canonService.js';
  import { hasLiveCanonMatch } from '@salt/domain';
  import { defaultListId } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';

  interface Props {
    params: { id: string };
  }
  let { params }: Props = $props();

  const recipe = $derived($recipes.find((r) => r.id === params.id) ?? null);

  function timeParts(): string[] {
    if (!recipe) return [];
    const m = recipe.metadata;
    const parts: string[] = [];
    if (m.servings !== null) parts.push(`Serves ${m.servings}`);
    if (m.prepTimeMinutes !== null) parts.push(`Prep ${m.prepTimeMinutes} min`);
    if (m.cookTimeMinutes !== null) parts.push(`Cook ${m.cookTimeMinutes} min`);
    if (m.totalTimeMinutes !== null) parts.push(`Total ${m.totalTimeMinutes} min`);
    return parts;
  }

  // ─── Canon live-id set (for dangling-match derivation) ───────────────────────
  const liveCanonIds = $derived(new Set($canonItems.map((c) => c.id)));

  // ─── Canonicalise ────────────────────────────────────────────────────────────
  let canonalising = $state(false);

  const hasParsedPending = $derived(
    recipe !== null &&
      recipe.ingredients.some((g) =>
        g.items.some((ing) => ing.parsed !== null && !hasLiveCanonMatch(ing, liveCanonIds)),
      ),
  );

  async function handleCanonicalise(): Promise<void> {
    if (!recipe) return;
    canonalising = true;
    const result = await canonicaliseIngredients(recipe);
    canonalising = false;
    if (result.kind !== 'ok') {
      addToast('Canonicalisation failed.', 'destructive');
      return;
    }
    addToast('Ingredients matched.', 'success');
  }

  // ─── Add to shopping list ─────────────────────────────────────────────────
  let addToListOpen = $state(false);
  let addToListBusy = $state(false);
  let selectedServings = $state(1);

  $effect(() => {
    if (addToListOpen) {
      selectedServings = recipe?.metadata.servings ?? 1;
    }
  });

  async function handleAddToList(): Promise<void> {
    if (!recipe) return;
    const listId = $defaultListId;
    if (!listId) {
      addToast('No shopping list found. Create one first.', 'destructive');
      addToListOpen = false;
      return;
    }
    addToListBusy = true;
    const result = await addRecipeToShoppingList(recipe, listId, selectedServings);
    addToListBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to add to shopping list.', 'destructive');
      return;
    }
    addToListOpen = false;
    addToast('Added to shopping list.', 'success');
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);

  async function handleDelete(): Promise<void> {
    if (!recipe) return;
    const title = recipe.title;
    deleteBusy = true;
    const result = await removeRecipe(recipe.id);
    deleteBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to delete recipe.', 'destructive');
      return;
    }
    deleteOpen = false;
    addToast(`Deleted ${title}`, 'success');
    push('/recipes');
  }
</script>

{#if recipe === null}
  <div class="p-4 sm:p-6">
    {#if $isLoadingRecipes}
      <p class="text-sm text-muted-foreground">Loading…</p>
    {:else}
      <p class="text-sm text-muted-foreground">Recipe not found.</p>
      <Button variant="outline" class="mt-4" onclick={() => push('/recipes')}
        >Back to recipes</Button
      >
    {/if}
  </div>
{:else}
  <DetailPage
    title={recipe.title}
    onBack={() => push('/recipes')}
    backLabel="Recipes"
    class="p-4 sm:p-6"
  >
    {#snippet actions()}
      <Button
        size="sm"
        variant="outline"
        onclick={() => (addToListOpen = true)}
        data-testid="recipe-add-to-list-button"
      >
        {#snippet leading()}<Icon name="ShoppingCart" size={16} />{/snippet}
        Add to list
      </Button>
      <Button
        size="sm"
        onclick={() => push(`/recipes/${recipe.id}/edit`)}
        data-testid="recipe-edit-button"
      >
        {#snippet leading()}<Icon name="Pencil" size={16} />{/snippet}
        Edit
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onclick={() => (deleteOpen = true)}
        data-testid="recipe-delete-button"
      >
        {#snippet leading()}<Icon name="Trash2" size={16} />{/snippet}
        Delete
      </Button>
    {/snippet}

    <div class="flex flex-col gap-8" data-testid="recipe-view">
      {#if recipe.description}
        <p class="text-sm text-muted-foreground">{recipe.description}</p>
      {/if}

      {#if timeParts().length > 0 || recipe.metadata.tags.length > 0}
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {#each timeParts() as part (part)}
            <span class="rounded bg-muted px-2 py-1">{part}</span>
          {/each}
          {#each recipe.metadata.tags as tag (tag)}
            <span class="rounded bg-muted px-2 py-1">#{tag}</span>
          {/each}
        </div>
      {/if}

      <!-- Ingredients -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium">Ingredients</p>
          {#if hasParsedPending}
            <Button
              size="sm"
              variant="outline"
              onclick={handleCanonicalise}
              loading={canonalising}
              disabled={canonalising}
              data-testid="recipe-canonicalise-button"
            >
              {#snippet leading()}<Icon name="Link" size={14} />{/snippet}
              Canonicalise
            </Button>
          {/if}
        </div>
        {#if recipe.ingredients.length === 0}
          <p class="text-sm text-muted-foreground">No ingredients.</p>
        {/if}
        {#each recipe.ingredients as group (group.id)}
          <div class="flex flex-col gap-1" data-testid="recipe-view-group">
            {#if group.name}
              <p class="text-sm font-medium" data-testid="recipe-view-group-name">{group.name}</p>
            {/if}
            <ul class="flex flex-col gap-1">
              {#each group.items as ingredient (ingredient.id)}
                <li class="text-sm" data-testid="recipe-view-ingredient">
                  {ingredient.rawText}{#if ingredient.parsed?.convertedWeight}<span
                      class="ml-1 text-xs text-muted-foreground"
                      >({ingredient.parsed.convertedWeight.value}{ingredient.parsed.convertedWeight
                        .unit})</span
                    >{/if}{#if ingredient.isOptional}<span
                      class="ml-1 text-xs text-muted-foreground">(optional)</span
                    >{/if}{#if hasLiveCanonMatch(ingredient, liveCanonIds)}<span
                      class="ml-1 text-xs text-green-600"
                      title="Matched"
                      data-testid="match-state-matched">✓</span
                    >{:else if ingredient.matchState === 'failed'}<span
                      class="ml-1 text-xs text-destructive"
                      title="Match failed"
                      data-testid="match-state-failed">✗</span
                    >{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </section>

      <!-- Method -->
      <section class="flex flex-col gap-3">
        <p class="text-sm font-medium">Method</p>
        {#if recipe.steps.length === 0}
          <p class="text-sm text-muted-foreground">No steps.</p>
        {/if}
        <ol class="flex flex-col gap-3">
          {#each recipe.steps as step, idx (step.id)}
            <li class="flex gap-3 text-sm" data-testid="recipe-view-step">
              <span class="font-medium text-muted-foreground">{idx + 1}.</span>
              <div class="flex flex-col gap-1 flex-1">
                <div class="flex items-start gap-1">
                  <span class="flex-1">{step.text}</span>
                  {#if step.note}
                    <Popover>
                      <PopoverTrigger>
                        <button
                          class="shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label="View step note"
                          data-testid="recipe-step-note-trigger"
                        >
                          <Icon name="StickyNote" size={14} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="top" align="end" class="max-w-xs">
                        <p
                          class="text-sm whitespace-pre-wrap"
                          data-testid="recipe-step-note-content"
                        >
                          {step.note}
                        </p>
                      </PopoverContent>
                    </Popover>
                  {/if}
                </div>
                {#if step.timer}
                  <span class="text-xs text-muted-foreground">
                    ⏱ {step.timer.durationMinutes} min{step.timer.description
                      ? ` — ${step.timer.description}`
                      : ''}
                  </span>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      </section>

      {#if recipe.notes}
        <section class="flex flex-col gap-2">
          <p class="text-sm font-medium">Notes</p>
          <p class="whitespace-pre-wrap text-sm text-muted-foreground">{recipe.notes}</p>
        </section>
      {/if}
    </div>
  </DetailPage>
{/if}

<!-- Add to shopping list dialog -->
<Dialog
  bind:open={addToListOpen}
  onOpenChange={(v) => {
    if (!v) addToListBusy = false;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="recipe-add-to-list-dialog">
      <DialogHeader>
        <DialogTitle>Add to shopping list</DialogTitle>
        <DialogDescription>Choose how many servings to shop for.</DialogDescription>
      </DialogHeader>
      <div class="flex items-center justify-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onclick={() => (selectedServings = Math.max(1, selectedServings - 1))}
          disabled={selectedServings <= 1 || addToListBusy}
          aria-label="Decrease servings"
          data-testid="recipe-servings-decrease"
        >
          <Icon name="Minus" size={14} />
        </Button>
        <span
          class="min-w-[3rem] text-center text-sm font-medium"
          data-testid="recipe-servings-value"
          >{selectedServings} serving{selectedServings === 1 ? '' : 's'}</span
        >
        <Button
          variant="outline"
          size="sm"
          onclick={() => (selectedServings = selectedServings + 1)}
          disabled={addToListBusy}
          aria-label="Increase servings"
          data-testid="recipe-servings-increase"
        >
          <Icon name="Plus" size={14} />
        </Button>
      </div>
      <DialogFooter>
        <Button variant="outline" onclick={() => (addToListOpen = false)} disabled={addToListBusy}>
          Cancel
        </Button>
        <Button
          onclick={handleAddToList}
          loading={addToListBusy}
          disabled={addToListBusy}
          data-testid="recipe-add-to-list-confirm"
        >
          Add to list
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>

<!-- Delete confirm dialog -->
<Dialog
  bind:open={deleteOpen}
  onOpenChange={(v) => {
    if (!v) deleteBusy = false;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="recipe-delete-dialog">
      <DialogHeader>
        <DialogTitle>Delete "{recipe?.title ?? ''}"?</DialogTitle>
        <DialogDescription>This action cannot be undone.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (deleteOpen = false)} disabled={deleteBusy}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onclick={handleDelete}
          loading={deleteBusy}
          disabled={deleteBusy}
          data-testid="recipe-delete-confirm"
        >
          Delete
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
