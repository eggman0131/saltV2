<script lang="ts">
  import { Button, ListPage, Icon, TextField } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    recipes,
    isLoadingRecipes,
    importRecipeFromUrl,
    urlImportMessage,
    stashImportedDraft,
  } from '../../lib/recipeService.js';
  import { addToast } from '../../lib/toastStore.js';

  const sorted = $derived([...$recipes].sort((a, b) => a.title.localeCompare(b.title)));

  function ingredientCount(recipe: (typeof sorted)[number]): number {
    return recipe.ingredients.reduce((n, g) => n + g.items.length, 0);
  }

  // ─── Import from URL ──────────────────────────────────────────────────────────
  let showImport = $state(false);
  let importUrl = $state('');
  let importing = $state(false);

  async function handleImport(): Promise<void> {
    const url = importUrl.trim();
    if (importing || url === '') return;
    importing = true;
    const result = await importRecipeFromUrl(url);
    importing = false;
    if (result.kind !== 'ok') {
      // Friendly, specific message; the input stays open so the user can fix the
      // URL and retry, or fall back to manual/chat.
      addToast(urlImportMessage(result.error), 'destructive');
      return;
    }
    // Hand the converted draft to the editor and route into it pre-filled. If
    // navigation itself fails, surface it rather than silently closing the form
    // and stranding the user with no editor and no error.
    stashImportedDraft(result.value);
    try {
      push('/recipes/new');
      showImport = false;
      importUrl = '';
    } catch {
      addToast('Could not open the editor — please try again.', 'destructive');
    }
  }
</script>

<ListPage
  title="Recipes"
  description="Your recipe collection."
  isLoading={$isLoadingRecipes}
  isEmpty={sorted.length === 0}
  class="p-4 sm:p-6"
>
  {#snippet actions()}
    <Button
      variant="outline"
      size="sm"
      onclick={() => (showImport = !showImport)}
      data-testid="recipe-import-url-toggle"
    >
      {#snippet leading()}<Icon name="Link" size={16} />{/snippet}
      Import from URL
    </Button>
    <Button size="sm" onclick={() => push('/recipes/new')} data-testid="recipe-new-btn">
      New recipe
    </Button>
  {/snippet}

  {#snippet empty()}
    <div class="flex flex-col items-center gap-3 py-12 text-center">
      <p class="text-sm text-muted-foreground">No recipes yet.</p>
      <div class="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={() => (showImport = !showImport)}
          data-testid="recipe-import-url-toggle-empty"
        >
          {#snippet leading()}<Icon name="Link" size={16} />{/snippet}
          Import from URL
        </Button>
        <Button size="sm" onclick={() => push('/recipes/new')}>Create your first recipe</Button>
      </div>
      {#if showImport}
        <div
          class="mt-2 flex w-full max-w-md flex-col gap-2 rounded border border-border bg-muted/50 p-3 text-left"
          data-testid="recipe-import-url-area"
        >
          <div class="flex items-end gap-2">
            <TextField
              label="Recipe URL"
              placeholder="https://example.com/recipe"
              value={importUrl}
              onValueChange={(v) => (importUrl = v)}
              class="flex-1"
              data-testid="recipe-import-url-input"
            />
            <Button
              size="sm"
              onclick={handleImport}
              loading={importing}
              disabled={importUrl.trim() === '' || importing}
              data-testid="recipe-import-url-btn"
            >
              Import
            </Button>
          </div>
        </div>
      {/if}
    </div>
  {/snippet}

  {#snippet children()}
    {#if showImport}
      <div
        class="mb-3 flex flex-col gap-2 rounded border border-border bg-muted/50 p-3"
        data-testid="recipe-import-url-area"
      >
        <p class="text-sm text-muted-foreground">
          Paste a recipe link. We'll read the page and convert it to metric and British terms — then
          drop you into the editor to review and save.
        </p>
        <div class="flex items-end gap-2">
          <TextField
            label="Recipe URL"
            placeholder="https://example.com/recipe"
            value={importUrl}
            onValueChange={(v) => (importUrl = v)}
            class="flex-1"
            data-testid="recipe-import-url-input"
          />
          <Button
            size="sm"
            onclick={handleImport}
            loading={importing}
            disabled={importUrl.trim() === '' || importing}
            data-testid="recipe-import-url-btn"
          >
            Import
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onclick={() => {
              showImport = false;
              importUrl = '';
            }}
            disabled={importing}
          >
            Cancel
          </Button>
        </div>
      </div>
    {/if}

    <ul class="flex flex-col gap-1" data-testid="recipe-list">
      {#each sorted as recipe (recipe.id)}
        <li>
          <button
            class="w-full rounded px-2 py-2 text-left text-sm font-medium hover:bg-muted"
            onclick={() => push(`/recipes/${recipe.id}`)}
            data-testid="recipe-list-item"
            data-recipe-id={recipe.id}
          >
            {recipe.title}
            <span class="ml-2 text-xs font-normal text-muted-foreground">
              {ingredientCount(recipe)} ingredient{ingredientCount(recipe) === 1 ? '' : 's'}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/snippet}
</ListPage>
