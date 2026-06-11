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
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { recipes, isLoadingRecipes, removeRecipe } from '../../lib/recipeService.js';
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
        <p class="text-sm font-medium">Ingredients</p>
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
                  {ingredient.rawText}
                  {#if ingredient.isOptional}
                    <span class="ml-1 text-xs text-muted-foreground">(optional)</span>
                  {/if}
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
              <div class="flex flex-col gap-1">
                <span>{step.text}</span>
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
