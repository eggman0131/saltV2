<script lang="ts">
  import {
    Button,
    ListPage,
    Icon,
    TextField,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import type { Recipe } from '@salt/domain';
  import {
    recipes,
    isLoadingRecipes,
    importRecipeFromUrl,
    urlImportMessage,
    stashImportedDraft,
  } from '../../lib/recipeService.js';
  import { addToast } from '../../lib/toastStore.js';

  function ingredientCount(recipe: Recipe): number {
    return recipe.ingredients.reduce((n, g) => n + g.items.length, 0);
  }

  function heroUrl(recipe: Recipe): string | null {
    return recipe.image?.url && !recipe.imageHidden ? recipe.image.url : null;
  }

  // ─── Search / sort / filter ───────────────────────────────────────────────────
  // The whole recipes collection is subscribed in memory (recipeService), so all
  // of this is a pure client-side pipeline — no extra Firestore reads or indexes.
  type SortBy = 'title' | 'recent' | 'quickest' | 'fewest';
  const SORT_LABELS: Record<SortBy, string> = {
    title: 'A–Z',
    recent: 'Recently added',
    quickest: 'Quickest',
    fewest: 'Fewest ingredients',
  };

  let searchText = $state('');
  let sortBy = $state<SortBy>('title');
  let activeTags = $state<string[]>([]);

  const query = $derived(searchText.trim().toLowerCase());

  function matchesSearch(r: Recipe): boolean {
    if (query === '') return true;
    return (
      r.title.toLowerCase().includes(query) ||
      r.metadata.tags.some((t) => t.toLowerCase().includes(query))
    );
  }

  // AND-narrowing: a recipe must carry every selected tag ("quick" + "vegetarian").
  function matchesTags(r: Recipe): boolean {
    return activeTags.every((t) => r.metadata.tags.includes(t));
  }

  const visible = $derived(
    $recipes
      .filter((r) => matchesSearch(r) && matchesTags(r))
      .sort((a, b) => {
        switch (sortBy) {
          case 'recent':
            return b.createdAt.localeCompare(a.createdAt);
          case 'quickest':
            return (
              (a.metadata.totalTimeMinutes ?? Infinity) - (b.metadata.totalTimeMinutes ?? Infinity)
            );
          case 'fewest':
            return ingredientCount(a) - ingredientCount(b);
          case 'title':
          default:
            return a.title.localeCompare(b.title);
        }
      }),
  );

  const hasFilters = $derived(query !== '' || activeTags.length > 0);

  // Tags offered as filter chips: those present on the currently displayed
  // recipes, so the choices narrow as you filter (a faceted drill-down) rather
  // than always listing every tag in the library. Active tags are pinned in so
  // they stay deselectable even if the result set momentarily empties.
  const visibleTags = $derived(
    [...new Set([...visible.flatMap((r) => r.metadata.tags), ...activeTags])].sort((a, b) =>
      a.localeCompare(b),
    ),
  );

  function toggleTag(tag: string): void {
    activeTags = activeTags.includes(tag)
      ? activeTags.filter((t) => t !== tag)
      : [...activeTags, tag];
  }

  function clearFilters(): void {
    searchText = '';
    activeTags = [];
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
  isEmpty={$recipes.length === 0}
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

    <!-- Search + sort toolbar -->
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <div class="relative min-w-48 flex-1">
        <Icon
          name="Search"
          size={16}
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          class="w-full rounded border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground"
          placeholder="Search recipes…"
          type="search"
          bind:value={searchText}
          data-testid="recipe-search-input"
        />
      </div>
      <Select value={sortBy} onValueChange={(v) => (sortBy = v as SortBy)}>
        <SelectTrigger class="w-44" data-testid="recipe-sort-trigger">
          {SORT_LABELS[sortBy]}
        </SelectTrigger>
        <SelectContent>
          {#each Object.entries(SORT_LABELS) as [value, label] (value)}
            <SelectItem {value}>{label}</SelectItem>
          {/each}
        </SelectContent>
      </Select>
    </div>

    <!-- Tag filter chips — scoped to tags on the currently displayed recipes -->
    {#if visibleTags.length > 0}
      <div class="mb-3 flex flex-wrap gap-1.5" data-testid="recipe-tag-filters">
        {#each visibleTags as tag (tag)}
          {@const active = activeTags.includes(tag)}
          <button
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs transition-colors {active
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:bg-muted'}"
            aria-pressed={active}
            onclick={() => toggleTag(tag)}
            data-testid="recipe-tag-filter"
            data-tag={tag}
          >
            #{tag}
          </button>
        {/each}
      </div>
    {/if}

    <!-- Result count -->
    <div class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span data-testid="recipe-result-count">
        {visible.length}
        {visible.length === 1 ? 'recipe' : 'recipes'}
        {#if hasFilters}<span class="text-muted-foreground/70">· filtered</span>{/if}
      </span>
      {#if hasFilters}
        <button
          type="button"
          class="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          onclick={clearFilters}
          data-testid="recipe-clear-filters"
        >
          <Icon name="X" size={12} /> Clear
        </button>
      {/if}
    </div>

    {#if visible.length === 0}
      <div
        class="flex flex-col items-center gap-2 py-12 text-center"
        data-testid="recipe-no-matches"
      >
        <Icon name="Search" size={24} class="text-muted-foreground" />
        <p class="text-sm text-muted-foreground">No recipes match your filters.</p>
        <Button variant="outline" size="sm" onclick={clearFilters}>Clear filters</Button>
      </div>
    {:else}
      <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="recipe-list">
        {#each visible as recipe (recipe.id)}
          {@const url = heroUrl(recipe)}
          {@const count = ingredientCount(recipe)}
          {@const tags = recipe.metadata.tags}
          <li>
            <button
              class="group flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onclick={() => push(`/recipes/${recipe.id}`)}
              data-testid="recipe-list-item"
              data-recipe-id={recipe.id}
            >
              <div class="aspect-[3/2] w-full overflow-hidden bg-muted">
                {#if url}
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    data-testid="recipe-list-thumb"
                  />
                {:else}
                  <div
                    class="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/40 text-muted-foreground/60"
                    data-testid="recipe-list-thumb-fallback"
                  >
                    <Icon name="CookingPot" size={32} />
                  </div>
                {/if}
              </div>

              <div class="flex flex-1 flex-col gap-1.5 p-3">
                <h3 class="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                  {recipe.title}
                </h3>

                <div
                  class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
                >
                  {#if recipe.metadata.totalTimeMinutes !== null}
                    <span class="inline-flex items-center gap-1">
                      <Icon name="Clock" size={12} />
                      {recipe.metadata.totalTimeMinutes} min
                    </span>
                  {/if}
                  {#if recipe.metadata.servings !== null}
                    <span class="inline-flex items-center gap-1">
                      <Icon name="Users" size={12} />
                      {recipe.metadata.servings}
                    </span>
                  {/if}
                  <span class="inline-flex items-center gap-1">
                    <Icon name="Carrot" size={12} />
                    {count}
                  </span>
                </div>

                {#if tags.length > 0}
                  <div class="mt-0.5 flex flex-wrap items-center gap-1">
                    {#each tags.slice(0, 3) as tag (tag)}
                      <span
                        class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        #{tag}
                      </span>
                    {/each}
                    {#if tags.length > 3}
                      <span class="text-[10px] text-muted-foreground/70">+{tags.length - 3}</span>
                    {/if}
                  </div>
                {/if}
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
</ListPage>
