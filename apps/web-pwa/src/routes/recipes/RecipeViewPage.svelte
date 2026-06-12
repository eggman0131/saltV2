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
    matchIngredient,
    persistRecipe,
  } from '../../lib/recipeService.js';
  import RecipeAddToListSheet from './RecipeAddToListSheet.svelte';
  import { canonItems } from '../../lib/canonService.js';
  import { hasLiveCanonMatch, type IngredientGroup, type Ingredient } from '@salt/domain';
  import { defaultListId } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';
  import { auth } from '../../lib/auth.svelte.js';
  import { createChatSession } from '../../lib/chatService.js';
  import AdminGuard from '../admin/AdminGuard.svelte';

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

  // ─── Per-row rematch ─────────────────────────────────────────────────────────
  // The unmatched indicator (✗) is the trigger: tapping it parses + canon-matches
  // that single ingredient and persists the recipe. Re-derives from the current
  // store copy and discards the result if the row changed mid-flight.
  let matchingIds = $state<Record<string, boolean>>({});

  async function handleRematch(group: IngredientGroup, ing: Ingredient): Promise<void> {
    if (!recipe || matchingIds[ing.id]) return;
    matchingIds = { ...matchingIds, [ing.id]: true };
    const result = await matchIngredient(ing);
    matchingIds = { ...matchingIds, [ing.id]: false };
    if (result.kind !== 'ok') {
      addToast('Failed to match ingredient.', 'destructive');
      return;
    }
    const current = $recipes.find((r) => r.id === recipe.id);
    if (!current) return;
    const updatedGroups = current.ingredients.map((g) =>
      g.id !== group.id
        ? g
        : {
            ...g,
            items: g.items.map((i) =>
              i.id === ing.id && i.rawText === ing.rawText ? result.value : i,
            ),
          },
    );
    const persisted = await persistRecipe({ ...current, ingredients: updatedGroups });
    if (persisted.kind !== 'ok') {
      addToast('Failed to save match.', 'destructive');
    }
  }

  // ─── Add to shopping list ─────────────────────────────────────────────────
  // The review sheet (issue #185) owns servings + per-ingredient Add/Check
  // toggles + the commit; this page only guards that a default list exists.
  let addToListOpen = $state(false);

  function openAddToList(): void {
    if (!$defaultListId) {
      addToast('No shopping list found. Create one first.', 'destructive');
      return;
    }
    addToListOpen = true;
  }

  // ─── Ask / amend ────────────────────────────────────────────────────────────
  let amendBusy = $state(false);

  async function handleAskAmend(): Promise<void> {
    if (!recipe) return;
    const uid = auth.user?.uid;
    if (!uid) return;
    amendBusy = true;
    const result = await createChatSession(uid, recipe.id);
    amendBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to open chat.', 'destructive');
      return;
    }
    push(`/chat/${result.value.id}`);
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

<!-- Recipe module gated to admins while incomplete (#179). -->
<AdminGuard>
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
          onclick={handleAskAmend}
          loading={amendBusy}
          disabled={amendBusy}
          data-testid="recipe-ask-amend-button"
        >
          {#snippet leading()}<Icon name="ChefHat" size={16} />{/snippet}
          Ask / amend
        </Button>
        <Button
          size="sm"
          variant="outline"
          onclick={openAddToList}
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
                        >({ingredient.parsed.convertedWeight.value}{ingredient.parsed
                          .convertedWeight.unit})</span
                      >{/if}{#if ingredient.isOptional}<span
                        class="ml-1 text-xs text-muted-foreground">(optional)</span
                      >{/if}{#if !hasLiveCanonMatch(ingredient, liveCanonIds)}<button
                        type="button"
                        class="ml-1 text-xs text-destructive hover:underline disabled:opacity-50"
                        title="Not matched — tap to match"
                        aria-label="Not matched — tap to match"
                        onclick={() => handleRematch(group, ingredient)}
                        disabled={matchingIds[ingredient.id] ?? false}
                        data-testid="match-state-unmatched"
                        >{(matchingIds[ingredient.id] ?? false) ? '…' : '✗'}</button
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

  <!-- Add to shopping list review sheet -->
  {#if recipe && $defaultListId}
    <RecipeAddToListSheet {recipe} listId={$defaultListId} bind:open={addToListOpen} />
  {/if}

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
</AdminGuard>
