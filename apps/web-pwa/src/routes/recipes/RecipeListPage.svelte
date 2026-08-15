<script lang="ts">
  import {
    Button,
    ListPage,
    Icon,
    TextField,
    Popover,
    PopoverContent,
    PopoverTrigger,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { trackUsageEvent } from '@salt/observability';
  import { appendCacheBuster, takesIngredients, type Recipe, type RecipeKind } from '@salt/domain';
  import {
    recipes,
    isLoadingRecipes,
    importRecipeFromUrl,
    urlImportMessage,
    isSignedOutFailure,
    stashImportedDraft,
    stashPendingImportUrl,
    takePendingImportUrl,
  } from '../../lib/recipeService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { auth } from '../../lib/auth.svelte.js';
  import { KIND_COPY, KIND_SECTIONS, PRIMARY_KIND_SECTIONS, kindOf } from './recipeKind.js';
  import RecipeImportPhotoDialog from './RecipeImportPhotoDialog.svelte';

  function ingredientCount(recipe: Recipe): number {
    return recipe.ingredients.reduce((n, g) => n + g.items.length, 0);
  }

  function heroUrl(recipe: Recipe): string | null {
    // Display-time cache-bust (issue #460): a regenerated hero reuses the same
    // byte-identical Storage URL, so bust it with the per-regeneration nonce
    // (`imageRequestedAt`, falling back to `updatedAt`) only when an image is
    // present — absent recipes still return null for the fallback tile.
    // `imageHidden` is retired (inert, kept for back-compat) and no longer read,
    // mirroring the detail page: a hero shows whenever an image URL exists.
    return recipe.image?.url
      ? appendCacheBuster(recipe.image.url, recipe.imageRequestedAt ?? recipe.updatedAt)
      : null;
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

  // ─── Section (kind) ───────────────────────────────────────────────────────────
  // Which SECTION of the library you are looking at (issue #637) — deliberately
  // not a filter. It is single-select, it always has exactly one value, and it
  // is never cleared: "Clear filters" drops your search and tags but leaves you
  // exactly where you were standing. The default keeps the page as it was —
  // Recipes, and only recipes.
  //
  // This is one of the two places allowed to compare a kind directly: which
  // section an entry belongs to is an identity question, not a capability one.
  let kindFilter = $state<RecipeKind>('recipe');

  const kindCopy = $derived(KIND_COPY[kindFilter]);

  function selectKind(kind: RecipeKind): void {
    if (kind === kindFilter) return;
    kindFilter = kind;
    // Tags are per-section vocabulary: "baking" means nothing among takeaways,
    // and carrying it across would land you on an empty page you did not ask
    // for. The search box is different — a word you typed is still what you are
    // looking for, so it survives the switch.
    activeTags = [];
    showAllTags = false;
  }

  // Popover open state for the "New" and sort menus, plus the two chip-row
  // expanders (sections, tags).
  let newMenuOpen = $state(false);
  let sortMenuOpen = $state(false);
  let showAllTags = $state(false);
  let showAllKinds = $state(false);

  // Collapsed, the row offers the primary sections only; the rest sit behind a
  // "+N more" chip in the tag row's idiom. The section you are STANDING in is
  // pinned in regardless — collapsing must never hide the chip that says where
  // you are, and single-select means there is always exactly one to pin.
  const shownKinds = $derived.by(() => {
    if (showAllKinds) return KIND_SECTIONS;
    const primary = KIND_SECTIONS.filter((k) => PRIMARY_KIND_SECTIONS.includes(k));
    return primary.includes(kindFilter) ? primary : [...primary, kindFilter];
  });

  const hiddenKindCount = $derived(KIND_SECTIONS.length - shownKinds.length);

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

  // Section first, deliberately: `rankedTags` counts over `visible`, so putting
  // the kind ahead of the other predicates re-facets the tag chips to the
  // current section for free — no second pass, no separate per-section index.
  const visible = $derived(
    $recipes
      .filter((r) => kindOf(r) === kindFilter && matchesSearch(r) && matchesTags(r))
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

  // The section is NOT part of this. Clearing filters must not teleport you back
  // to Recipes, and "· filtered" must not appear merely because you are looking
  // at When you CBA.
  const hasFilters = $derived(query !== '' || activeTags.length > 0);

  // Ingredients are a capability, so this asks the domain rather than the kind.
  // Every card in `visible` shares `kindFilter`, so one answer covers the grid.
  const showIngredientCount = $derived(takesIngredients(kindFilter));

  // Tags offered as filter chips: those present on the currently displayed
  // recipes, so the choices narrow as you filter (a faceted drill-down) rather
  // than always listing every tag in the library. Ranked by how often each tag
  // occurs in the current view (most-used first, alpha tie-break) so the most
  // relevant chips lead — the count drives ordering only and is never shown.
  // Active tags are pinned in so they stay deselectable even if the result set
  // momentarily empties.
  const TAG_LIMIT = 10;

  const rankedTags = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const r of visible) {
      for (const t of r.metadata.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const t of activeTags) if (!counts.has(t)) counts.set(t, 0);
    return [...counts.keys()].sort((a, b) => {
      const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      return byCount !== 0 ? byCount : a.localeCompare(b);
    });
  });

  // Collapsed by default to the top TAG_LIMIT, expandable via a "+N" chip. Any
  // active tag past the cut is kept visible so it stays deselectable.
  const shownTags = $derived.by(() => {
    if (showAllTags || rankedTags.length <= TAG_LIMIT) return rankedTags;
    const top = rankedTags.slice(0, TAG_LIMIT);
    return [...top, ...activeTags.filter((t) => !top.includes(t))];
  });

  const hiddenTagCount = $derived(rankedTags.length - shownTags.length);

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

  // Set when the import failed because the session had died (issue #740). Held in
  // the sheet rather than shown as a toast: the recovery is an ACTION (go and
  // sign in), and a toast that counts down and vanishes is a bad place to put the
  // only route out. Every other failure keeps its existing toast.
  let signedOut = $state(false);

  // A URL rescued from an import that died on a signed-out session — see
  // stashPendingImportUrl. Reading it here reopens the sheet with the link
  // already in place, so signing back in costs the user nothing.
  const rescuedUrl = takePendingImportUrl();
  if (rescuedUrl !== null) {
    importUrl = rescuedUrl;
    showImport = true;
  }

  // Clear the stale client session so AuthGate falls through to the sign-in
  // screen. The URL is stashed FIRST: sign-out remounts the tree and takes this
  // component's state with it.
  async function handleSignInAgain(): Promise<void> {
    stashPendingImportUrl(importUrl);
    await auth.signOut();
  }

  async function handleImport(): Promise<void> {
    const url = importUrl.trim();
    if (importing || url === '') return;
    importing = true;
    signedOut = false;
    const result = await importRecipeFromUrl(url);
    importing = false;
    if (result.kind !== 'ok') {
      if (isSignedOutFailure(result.error)) {
        // No toast: the inline block below carries both the message and the way
        // out, and the pasted URL stays in the field for the retry.
        signedOut = true;
        return;
      }
      // Friendly, specific message; the input stays open so the user can fix the
      // URL and retry, or fall back to manual/chat.
      addToast(urlImportMessage(result.error), 'destructive');
      return;
    }
    // The callable already persisted the recipe (issue #616), flagged as not yet
    // reviewed — so this routes into the EXISTING recipe's editor, not
    // /recipes/new. The draft is still stashed so the editor paints immediately
    // instead of waiting for the Firestore listener to deliver a doc the server
    // just wrote. If navigation itself fails, surface it rather than silently
    // closing the form: the recipe exists either way, so the user isn't stranded.
    trackUsageEvent('recipe.created', {
      recipe_id: result.value.id,
      recipe_kind: result.value.kind,
      recipe_method: 'url',
    });
    stashImportedDraft(result.value);
    try {
      push(`/recipes/${result.value.id}/edit`);
      showImport = false;
      importUrl = '';
    } catch {
      addToast('Could not open the editor — please try again.', 'destructive');
    }
  }

  // ─── Import from photo (issue #649) ───────────────────────────────────────────
  // This page owns only the way in and the way out. Capturing, framing, the page
  // strip and the extraction call all live in RecipeImportPhotoDialog; it hands
  // back the persisted draft and we do exactly what the URL path does with one.
  let showPhotoImport = $state(false);

  function handlePhotoImported(recipe: Recipe): void {
    // Same hand-off as the URL path (issue #616): the callable has ALREADY
    // persisted the recipe flagged as not yet reviewed, so this routes into that
    // recipe's editor rather than /recipes/new. The draft is stashed so the
    // editor paints immediately instead of waiting for the Firestore listener.
    trackUsageEvent('recipe.created', {
      recipe_id: recipe.id,
      recipe_kind: recipe.kind,
      recipe_method: 'photo',
    });
    stashImportedDraft(recipe);
    try {
      push(`/recipes/${recipe.id}/edit`);
      showPhotoImport = false;
    } catch {
      addToast('Could not open the editor — please try again.', 'destructive');
    }
  }
</script>

<!--
  The signed-out recovery (issue #740). Rendered inside BOTH import areas (the
  empty state's and the list's) so the two cannot drift; declared here at the
  component's top level, which is what puts it in scope inside ListPage's
  snippets. Deliberately says nothing about the recipe site — being signed out
  is not that page's fault, and claiming it was is the whole defect.
-->
{#snippet signedOutNotice()}
  {#if signedOut}
    <div
      class="flex flex-col gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-sm sm:flex-row sm:items-center sm:justify-between"
      data-testid="recipe-import-signed-out"
      role="alert"
    >
      <span>You've been signed out — sign in and try again.</span>
      <Button
        size="sm"
        variant="outline"
        onclick={handleSignInAgain}
        data-testid="recipe-import-sign-in-btn"
      >
        Sign in
      </Button>
    </div>
  {/if}
{/snippet}

<ListPage
  title="Recipes"
  isLoading={$isLoadingRecipes}
  isEmpty={$recipes.length === 0}
  class="p-4 sm:p-6"
>
  {#snippet actions()}
    <Popover bind:open={newMenuOpen}>
      <PopoverTrigger>
        {#snippet children()}
          <button
            type="button"
            class="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            data-testid="recipe-new-btn"
            aria-label="New recipe"
          >
            <Icon name="Plus" size={16} />
            New
            <Icon name="ChevronDown" size={14} class="opacity-80" />
          </button>
        {/snippet}
      </PopoverTrigger>
      <PopoverContent align="end" class="min-w-48 p-1">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          onclick={() => {
            newMenuOpen = false;
            showImport = true;
          }}
          data-testid="recipe-new-import"
        >
          <Icon name="Link" size={14} />
          Import URL
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          onclick={() => {
            newMenuOpen = false;
            showPhotoImport = true;
          }}
          data-testid="recipe-new-import-photo"
        >
          <Icon name="Camera" size={14} />
          Import from photo
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          onclick={() => {
            newMenuOpen = false;
            push('/chat');
          }}
          data-testid="recipe-new-chat"
        >
          <Icon name="Sparkles" size={14} />
          Chat with AI
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          onclick={() => {
            newMenuOpen = false;
            push('/recipes/new');
          }}
          data-testid="recipe-new-manual"
        >
          <Icon name="Pencil" size={14} />
          Manual
        </button>
        <!-- One entry per non-recipe section (issue #637) — "When you CBA", then
             Cocktails. Derived from KIND_SECTIONS rather than written out per kind
             so a section and its way in can never disagree about which kinds
             exist. `recipe` is sliced off because its entry is the "Manual" button
             above, which routes to the bare /recipes/new an e2e spec pins.
             The kind is set by the route and never again — there is no selector in
             the editor, because an outing does not become a recipe. -->
        {#each KIND_SECTIONS.slice(1) as kind (kind)}
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onclick={() => {
              newMenuOpen = false;
              push(`/recipes/new/${kind}`);
            }}
            data-testid="recipe-new-{kind}"
          >
            <Icon name={KIND_COPY[kind].menuIcon} size={14} />
            {KIND_COPY[kind].label}
          </button>
        {/each}
      </PopoverContent>
    </Popover>
  {/snippet}

  {#snippet empty()}
    <div class="flex flex-col items-center gap-3 py-12 text-center">
      <p class="text-sm text-muted-foreground">No recipes yet.</p>
      <div class="flex flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={() => (showImport = !showImport)}
          data-testid="recipe-import-url-toggle-empty"
        >
          {#snippet leading()}<Icon name="Link" size={16} />{/snippet}
          Import from URL
        </Button>
        <!-- A peer of the URL button, deliberately: an empty library is exactly
             where someone stands holding a cookbook, and offering only a URL box
             there says photo import does not exist. -->
        <Button
          variant="outline"
          size="sm"
          onclick={() => (showPhotoImport = true)}
          data-testid="recipe-import-photo-toggle-empty"
        >
          {#snippet leading()}<Icon name="Camera" size={16} />{/snippet}
          Import from photo
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
          {@render signedOutNotice()}
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
              signedOut = false;
            }}
            disabled={importing}
          >
            Cancel
          </Button>
        </div>
        {@render signedOutNotice()}
      </div>
    {/if}

    <!-- Section chips (issue #637). Every section is always offered, including
         an empty one: you have to be able to walk into "When you CBA" and SEE
         that there is nothing there yet, otherwise the only signal that the
         section exists is a New-menu entry. Hand-rolled in the same idiom as the
         tag chips below (there is no chip primitive in @salt/ui-components),
         adapted to single-select — exactly one is pressed at all times.
         Collapsed to the primary sections by default and expanded by the same
         "+N more" chip the tags use: still offered, just not all at once. -->
    <div
      class="mb-3 flex flex-wrap gap-1.5"
      role="group"
      aria-label="Section"
      data-testid="recipe-kind-filters"
    >
      {#each shownKinds as kind (kind)}
        {@const active = kind === kindFilter}
        <button
          type="button"
          class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {active
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background text-muted-foreground hover:bg-muted'}"
          aria-pressed={active}
          onclick={() => selectKind(kind)}
          data-testid="recipe-kind-filter"
          data-kind={kind}
        >
          {KIND_COPY[kind].label}
        </button>
      {/each}
      {#if hiddenKindCount > 0}
        <button
          type="button"
          class="rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
          onclick={() => (showAllKinds = true)}
          data-testid="recipe-kind-show-all"
        >
          +{hiddenKindCount} more
        </button>
      {:else if showAllKinds}
        <button
          type="button"
          class="rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
          onclick={() => (showAllKinds = false)}
          data-testid="recipe-kind-show-less"
        >
          Show less
        </button>
      {/if}
    </div>

    <!-- Search + sort toolbar: search fills the row, sort collapses to an icon -->
    <div class="mb-3 flex items-center gap-2">
      <div class="relative min-w-0 flex-1">
        <Icon
          name="Search"
          size={16}
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          class="w-full rounded border border-input bg-background py-2 pl-9 pr-3 text-sm"
          placeholder="Search recipes…"
          type="search"
          bind:value={searchText}
          data-testid="recipe-search-input"
        />
      </div>
      <Popover bind:open={sortMenuOpen}>
        <PopoverTrigger>
          {#snippet children()}
            <button
              type="button"
              class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent"
              data-testid="recipe-sort-trigger"
              aria-label="Sort recipes"
              title={`Sort: ${SORT_LABELS[sortBy]}`}
            >
              <Icon name="ArrowUpDown" size={16} />
            </button>
          {/snippet}
        </PopoverTrigger>
        <PopoverContent align="end" class="min-w-52 p-1">
          <p class="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sort by
          </p>
          {#each Object.entries(SORT_LABELS) as [value, label] (value)}
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onclick={() => {
                sortBy = value as SortBy;
                sortMenuOpen = false;
              }}
              data-testid="recipe-sort-option"
              data-sort={value}
            >
              <Icon name="Check" size={14} class={sortBy === value ? '' : 'invisible'} />
              {label}
            </button>
          {/each}
        </PopoverContent>
      </Popover>
    </div>

    <!-- Tag filter chips — the current view's tags, ranked by usage: top 10 by
         default, expandable via a "+N more" chip. -->
    {#if rankedTags.length > 0}
      <div class="mb-3 flex flex-wrap gap-1.5" data-testid="recipe-tag-filters">
        {#each shownTags as tag (tag)}
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
        {#if hiddenTagCount > 0}
          <button
            type="button"
            class="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
            onclick={() => (showAllTags = true)}
            data-testid="recipe-tag-show-all"
          >
            +{hiddenTagCount} more
          </button>
        {:else if showAllTags && rankedTags.length > TAG_LIMIT}
          <button
            type="button"
            class="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
            onclick={() => (showAllTags = false)}
            data-testid="recipe-tag-show-less"
          >
            Show less
          </button>
        {/if}
      </div>
    {/if}

    <!-- Result count -->
    <div class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span data-testid="recipe-result-count">
        {visible.length}
        {visible.length === 1 ? kindCopy.one : kindCopy.many}
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

    {#if visible.length === 0 && hasFilters}
      <div
        class="flex flex-col items-center gap-2 py-12 text-center"
        data-testid="recipe-no-matches"
      >
        <Icon name="Search" size={24} class="text-muted-foreground" />
        <p class="text-sm text-muted-foreground">{kindCopy.noMatchText}</p>
        <Button variant="outline" size="sm" onclick={clearFilters}>Clear filters</Button>
      </div>
    {:else if visible.length === 0}
      <!-- An empty SECTION, not a failed filter — there is nothing to clear, so
           offering a "Clear filters" button here would be a dead end. -->
      <div
        class="flex flex-col items-center gap-2 py-12 text-center"
        data-testid="recipe-kind-empty"
      >
        <Icon name={kindCopy.thumbIcon} size={24} class="text-muted-foreground" />
        <p class="text-sm text-muted-foreground">{kindCopy.emptyText}</p>
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
              <div class="relative aspect-[3/2] w-full overflow-hidden bg-muted">
                <!--
                  Not-yet-read AI import (issue #616). Marker only — the whole card
                  is already a button, so clearing it happens on the recipe itself.
                  Amber chip matches the canon/product-form review idiom.
                -->
                {#if recipe.needs_approval}
                  <span
                    class="absolute left-2 top-2 z-10 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                    data-testid="recipe-unreviewed-badge"
                  >
                    Unreviewed
                  </span>
                {/if}
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
                    <Icon name={kindCopy.thumbIcon} size={32} />
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
                  {#if showIngredientCount}
                    <span class="inline-flex items-center gap-1">
                      <Icon name="Carrot" size={12} />
                      {count}
                    </span>
                  {/if}
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

<!-- Reachable from both the New menu and the empty state, so it is mounted
     outside ListPage's snippets — one dialog, one piece of state. -->
<RecipeImportPhotoDialog bind:open={showPhotoImport} onImported={handlePhotoImported} />
