<script lang="ts">
  import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    DetailPage,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Icon,
    ImageCropper,
    Markdown,
    Spinner,
    TextField,
    type ImageCropperHandle,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    recipes,
    isLoadingRecipes,
    removeRecipe,
    canonicaliseIngredients,
    matchIngredient,
    persistRecipe,
    authorRecipeTraced,
    regenerateRecipeImage,
    setRecipeImageUpload,
  } from '../../lib/recipeService.js';
  import RecipeAddToListSheet from './RecipeAddToListSheet.svelte';
  import { canonItems } from '../../lib/canonService.js';
  import {
    appendCacheBuster,
    hasLiveCanonMatch,
    type IngredientGroup,
    type Ingredient,
  } from '@salt/domain';
  import { defaultListId } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';
  import { auth } from '../../lib/auth.svelte.js';
  import { createChatSession, sessions, sendMessage } from '../../lib/chatService.js';
  import { saveRecipe as saveRecipeDoc } from '@salt/firebase-sync';

  interface Props {
    params: { id: string };
  }
  let { params }: Props = $props();

  const recipe = $derived($recipes.find((r) => r.id === params.id) ?? null);

  // Outbound link to the original recipe, only for url-sourced (imported) recipes
  // with a non-empty url. Manual/legacy recipes (source null) render nothing.
  const sourceUrl = $derived(
    recipe?.source?.type === 'url' && (recipe.source.url ?? '').trim() !== ''
      ? recipe.source.url!
      : null,
  );

  // "Makes: <name>" chip — resolve the produces canon link to its display name.
  // null when the recipe isn't linked or the canon item has since been deleted.
  const producesCanonName = $derived(
    recipe?.producesCanonId
      ? ($canonItems.find((c) => c.id === recipe.producesCanonId)?.name ?? null)
      : null,
  );

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

  // ─── Sidebar chat ────────────────────────────────────────────────────────────
  const activeSession = $derived(
    [...$sessions]
      .filter((s) => s.recipeId === recipe?.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
  );

  let sidebarStreamingText = $state('');
  let sidebarIsSending = $state(false);
  let sidebarInputText = $state('');
  let sidebarInputEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let sidebarMessagesEnd = $state<HTMLDivElement | undefined>(undefined);

  $effect(() => {
    // Read these reactive values so the effect re-runs and scrolls to the bottom
    // whenever messages or streaming text change.
    activeSession?.messages.length;
    sidebarStreamingText;
    sidebarMessagesEnd?.scrollIntoView({ behavior: 'smooth' });
  });

  async function handleStartSidebarChat(): Promise<void> {
    if (!recipe) return;
    const uid = auth.user?.uid;
    if (!uid) return;
    amendBusy = true;
    const result = await createChatSession(uid, recipe.id);
    amendBusy = false;
    if (result.kind !== 'ok') addToast('Failed to open chat.', 'destructive');
  }

  async function handleSidebarSend(): Promise<void> {
    if (!activeSession || !sidebarInputText.trim() || sidebarIsSending) return;
    const text = sidebarInputText.trim();
    sidebarInputText = '';
    if (sidebarInputEl) sidebarInputEl.style.height = '';
    sidebarIsSending = true;
    sidebarStreamingText = '';

    const result = await sendMessage(activeSession, text, (chunk) => {
      sidebarStreamingText += chunk;
    });

    sidebarIsSending = false;
    sidebarStreamingText = '';

    if (result.kind !== 'ok') {
      addToast('Failed to send message.', 'destructive');
      sidebarInputText = text;
    }
  }

  function handleSidebarKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSidebarSend();
    }
  }

  function handleSidebarInput(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    sidebarInputText = el.value;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  let sidebarIsApplying = $state(false);

  async function handleSidebarApplyChanges(): Promise<void> {
    if (!activeSession || !recipe || sidebarIsApplying) return;
    sidebarIsApplying = true;
    const existingTags = [...new Set($recipes.flatMap((r) => r.metadata.tags))];
    const result = await authorRecipeTraced(
      {
        messages: activeSession.messages,
        existingTags,
        recipeId: recipe.id,
      },
      recipe.title,
    );
    if (result.kind !== 'ok') {
      sidebarIsApplying = false;
      addToast('Failed to generate recipe update.', 'destructive');
      return;
    }
    const now = new Date().toISOString();
    const ai = result.value;
    const updated = {
      ...ai,
      id: recipe.id,
      createdAt: recipe.createdAt,
      updatedAt: now,
      // Preserve fields the AI always returns as null/empty (it only extracts from conversation)
      image: recipe.image,
      source: recipe.source,
      metadata: {
        servings: ai.metadata.servings ?? recipe.metadata.servings,
        totalTimeMinutes: ai.metadata.totalTimeMinutes ?? recipe.metadata.totalTimeMinutes,
        prepTimeMinutes: ai.metadata.prepTimeMinutes ?? recipe.metadata.prepTimeMinutes,
        cookTimeMinutes: ai.metadata.cookTimeMinutes ?? recipe.metadata.cookTimeMinutes,
        tags: ai.metadata.tags.length > 0 ? ai.metadata.tags : recipe.metadata.tags,
      },
    };
    const saveResult = await saveRecipeDoc(updated);
    sidebarIsApplying = false;
    if (saveResult.kind !== 'ok') {
      addToast('Failed to save recipe update.', 'destructive');
      return;
    }
    addToast('Recipe updated!', 'success');
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

  // ─── Hero image (issue #148, Tier-2) ─────────────────────────────────────────
  // The photoreal hero is generated automatically by the onRecipeWritten trigger
  // on create; the manual escape hatch is Regenerate (with an optional steer),
  // surfaced as a subtle overlay control on the image. While a (re)generation is
  // in flight the new URL simply arrives via the recipe subscription — there is no
  // in-flight flag on the doc, so `imageBusy` only guards the button between click
  // and callable return. `imageHidden` is retired (inert, kept for back-compat) so
  // hero visibility is purely "does an image URL exist".
  const heroVisible = $derived(!!recipe?.image?.url);
  let imageBusy = $state(false);
  let regenOpen = $state(false);
  let regenHint = $state('');

  async function runRegenerate(hint?: string): Promise<void> {
    if (!recipe || imageBusy) return;
    imageBusy = true;
    const result = await regenerateRecipeImage(recipe.id, hint);
    imageBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to start image generation.', 'destructive');
      return;
    }
    addToast('Generating a new image — it will appear shortly.', 'success');
  }

  function openRegenerate(): void {
    regenHint = '';
    regenOpen = true;
  }

  async function handleRegenerateConfirm(): Promise<void> {
    const hint = regenHint.trim();
    regenOpen = false;
    await runRegenerate(hint || undefined);
  }

  // ─── Upload a local photo (issue #455, Phase 2) ──────────────────────────────
  // Pick a file → crop to 3:2 (pan/zoom) in the ImageCropper primitive → Save
  // sends the cropped bytes (base64) to the setRecipeImageUpload callable, which
  // re-encodes and writes `recipe-images/{id}.webp` then stamps
  // `image = { url, source: 'upload' }`. The new URL arrives via the subscription;
  // a bumped `imageRequestedAt` nonce cache-busts the identical Storage URL so the
  // photo appears immediately. Regenerate never clobbers an uploaded photo (the
  // trigger skips `source: 'upload'`).
  let uploadOpen = $state(false);
  let uploadBusy = $state(false);
  let uploadSrc = $state<string | null>(null);
  let cropper = $state<ImageCropperHandle | undefined>(undefined);

  function openUpload(): void {
    clearUploadSrc();
    uploadBusy = false;
    uploadOpen = true;
  }

  // Object-URL lifecycle: revoke the previous blob URL before replacing/clearing
  // so a re-pick or a close doesn't leak it.
  function clearUploadSrc(): void {
    if (uploadSrc) URL.revokeObjectURL(uploadSrc);
    uploadSrc = null;
  }

  function handleUploadFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset the input so re-picking the SAME file still fires a change event.
    input.value = '';
    if (!file) return;
    clearUploadSrc();
    uploadSrc = URL.createObjectURL(file);
  }

  function handleUploadOpenChange(open: boolean): void {
    uploadOpen = open;
    if (!open) {
      clearUploadSrc();
      uploadBusy = false;
    }
  }

  async function handleUploadSave(): Promise<void> {
    if (!recipe || !cropper || uploadBusy) return;
    uploadBusy = true;
    const base64 = await cropper.getCroppedBase64();
    if (!base64) {
      uploadBusy = false;
      addToast('Could not read that image — try another.', 'destructive');
      return;
    }
    const result = await setRecipeImageUpload(recipe.id, base64, 'image/webp');
    uploadBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to upload image.', 'destructive');
      return;
    }
    handleUploadOpenChange(false);
    addToast('Photo updated.', 'success');
  }

  import type { QuantityDoc } from '@salt/domain/schemas';
  function formatMetricQty(q: QuantityDoc): string {
    if (q.type === 'range') return `${q.min}–${q.max}`;
    if (q.type === 'single') return String(q.value);
    return String(q.whole + q.numerator / q.denominator);
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

    <div class="grid gap-4 lg:grid-cols-[2fr_1fr] lg:gap-6" data-testid="recipe-view">
      <!-- Left column: main recipe content -->
      <div class="flex flex-col gap-4">
        <!-- Hero image (Tier-2, issue #148): photoreal "arty" photo generated
             from the title + description by the onRecipeWritten trigger. -->
        {#if heroVisible}
          <div class="flex flex-col gap-2" data-testid="recipe-hero">
            <div class="group relative overflow-hidden rounded-lg border bg-muted">
              <img
                src={appendCacheBuster(
                  recipe.image!.url,
                  recipe.imageRequestedAt ?? recipe.updatedAt,
                )}
                alt={recipe.title}
                loading="lazy"
                class="aspect-[3/2] w-full object-cover"
                data-testid="recipe-hero-image"
              />
              <!-- Regenerate + Upload as subtle overlay controls: hover-revealed
                   on desktop, faint-always-visible on touch (no hover). -->
              <div class="absolute right-2 top-2 flex gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  onclick={openUpload}
                  disabled={imageBusy}
                  ariaLabel="Upload a photo"
                  title="Upload a photo"
                  class="bg-background/80 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-60"
                  data-testid="recipe-image-upload"
                >
                  {#snippet leading()}<Icon name="Upload" size={16} />{/snippet}
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onclick={openRegenerate}
                  loading={imageBusy}
                  disabled={imageBusy}
                  ariaLabel="Regenerate image"
                  title="Regenerate image"
                  class="bg-background/80 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-60"
                  data-testid="recipe-image-regenerate"
                >
                  {#snippet leading()}<Icon name="RefreshCw" size={16} />{/snippet}
                </Button>
              </div>
            </div>
          </div>
        {:else}
          <div class="flex flex-wrap gap-2" data-testid="recipe-hero-controls">
            <Button
              size="sm"
              variant="outline"
              onclick={openRegenerate}
              loading={imageBusy}
              disabled={imageBusy}
              data-testid="recipe-image-generate"
            >
              {#snippet leading()}<Icon name="ImagePlus" size={14} />{/snippet}
              Generate image
            </Button>
            <Button
              size="sm"
              variant="outline"
              onclick={openUpload}
              disabled={imageBusy}
              data-testid="recipe-image-upload-empty"
            >
              {#snippet leading()}<Icon name="Upload" size={14} />{/snippet}
              Upload a photo
            </Button>
          </div>
        {/if}

        <!-- Description + meta chips -->
        {#if recipe.description || timeParts().length > 0 || recipe.metadata.tags.length > 0 || sourceUrl || producesCanonName}
          <Card>
            <CardContent class="flex flex-col gap-3 p-4">
              {#if recipe.description}
                <p class="text-sm text-muted-foreground">{recipe.description}</p>
              {/if}
              {#if timeParts().length > 0 || recipe.metadata.tags.length > 0 || producesCanonName}
                <div class="flex flex-wrap items-center gap-2">
                  {#if producesCanonName}
                    <span
                      class="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                      data-testid="recipe-produces-chip">Makes: {producesCanonName}</span
                    >
                  {/if}
                  {#each timeParts() as part (part)}
                    <span class="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                      >{part}</span
                    >
                  {/each}
                  {#each recipe.metadata.tags as tag (tag)}
                    <span class="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                      >#{tag}</span
                    >
                  {/each}
                </div>
              {/if}
              {#if sourceUrl}
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
                  data-testid="recipe-source-link"
                >
                  <Icon name="ExternalLink" size={14} />
                  View original recipe
                </a>
              {/if}
            </CardContent>
          </Card>
        {/if}

        <!-- Ingredients -->
        <Card>
          <CardHeader class="px-4 pt-4 pb-0">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm">Ingredients</CardTitle>
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
          </CardHeader>
          <CardContent class="px-4 pb-4 pt-3">
            {#if recipe.ingredients.length === 0}
              <p class="text-sm text-muted-foreground">No ingredients.</p>
            {/if}
            {#each recipe.ingredients as group (group.id)}
              <div class="flex flex-col gap-1 [&+&]:mt-3" data-testid="recipe-view-group">
                {#if group.name}
                  <p
                    class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    data-testid="recipe-view-group-name"
                  >
                    {group.name}
                  </p>
                {/if}
                <ul class="flex flex-col gap-1">
                  {#each group.items as ingredient (ingredient.id)}
                    <li class="text-sm" data-testid="recipe-view-ingredient">
                      {#if ingredient.parsed?.quantity && ingredient.parsed?.unit}{formatMetricQty(
                          ingredient.parsed.quantity,
                        )}{ingredient.parsed.unit}
                        {ingredient.parsed.item}{#if ingredient.parsed.preparation.length > 0}, {ingredient.parsed.preparation.join(
                            ', ',
                          )}{/if}{#if ingredient.parsed.displayText}<span
                            class="ml-1 text-xs text-muted-foreground"
                            >({ingredient.parsed.displayText})</span
                          >{/if}{:else}{ingredient.rawText}{/if}{#if ingredient.isOptional}<span
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
          </CardContent>
        </Card>

        <!-- Method -->
        <Card>
          <CardHeader class="px-4 pt-4 pb-0">
            <CardTitle class="text-sm">Method</CardTitle>
          </CardHeader>
          <CardContent class="px-4 pb-4 pt-3">
            {#if recipe.steps.length === 0}
              <p class="text-sm text-muted-foreground">No steps.</p>
            {/if}
            <ol class="flex flex-col gap-4">
              {#each recipe.steps as step, idx (step.id)}
                <li class="flex gap-3 text-sm" data-testid="recipe-view-step">
                  <span class="mt-0.5 shrink-0 font-semibold text-muted-foreground">{idx + 1}</span>
                  <div class="flex flex-1 flex-col gap-1.5">
                    <span>{step.text}</span>
                    {#if step.note}
                      <div
                        class="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                        data-testid="recipe-step-note-content"
                      >
                        <Icon
                          name="TriangleAlert"
                          size={13}
                          class="mt-0.5 shrink-0 text-amber-500"
                        />
                        <span class="whitespace-pre-wrap">{step.note}</span>
                      </div>
                    {/if}
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
          </CardContent>
        </Card>

        <!-- Notes -->
        {#if recipe.notes}
          <Card>
            <CardHeader class="px-4 pt-4 pb-0">
              <CardTitle class="text-sm">Notes</CardTitle>
            </CardHeader>
            <CardContent class="px-4 pb-4 pt-3">
              <p class="whitespace-pre-wrap text-sm text-muted-foreground">{recipe.notes}</p>
            </CardContent>
          </Card>
        {/if}
      </div>

      <!-- Right column: embedded chat sidebar (desktop only) -->
      <div class="hidden lg:flex lg:flex-col">
        <Card
          class="flex flex-col overflow-hidden lg:sticky lg:top-4 lg:min-h-0 lg:max-h-[calc(100dvh_-_5.5rem)] lg:flex-1"
        >
          <CardHeader class="shrink-0 border-b px-4 py-3">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm">Chef Chat</CardTitle>
              {#if activeSession}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => push(`/chat/${activeSession!.id}`)}
                  aria-label="Open full chat"
                >
                  <Icon name="ExternalLink" size={14} />
                </Button>
              {/if}
            </div>
            {#if !activeSession}
              <CardDescription class="text-xs">
                Chat about this recipe while you cook.
              </CardDescription>
            {/if}
          </CardHeader>

          {#if activeSession === null}
            <!-- No session yet: prompt to start -->
            <CardContent
              class="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center"
            >
              <p class="text-sm text-muted-foreground">
                Ask your chef to refine this recipe, scale it, or answer cooking questions.
              </p>
              <Button
                size="sm"
                variant="outline"
                class="w-full"
                onclick={handleStartSidebarChat}
                loading={amendBusy}
                disabled={amendBusy}
              >
                {#snippet leading()}<Icon name="ChefHat" size={16} />{/snippet}
                Start a chat
              </Button>
            </CardContent>
          {:else}
            <!-- Messages -->
            <div class="min-h-0 flex-1 overflow-y-auto p-4">
              <div class="flex flex-col gap-3">
                {#if activeSession.messages.length === 0 && !sidebarIsSending}
                  <p class="py-8 text-center text-xs text-muted-foreground">
                    Ask me anything about this recipe.
                  </p>
                {/if}
                {#each activeSession.messages as msg (msg.id)}
                  <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
                    <div
                      class="max-w-[90%] text-sm {msg.role === 'user'
                        ? 'rounded-lg bg-muted px-3 py-2'
                        : ''}"
                    >
                      {#if msg.role === 'assistant'}
                        <Markdown text={msg.text} />
                      {:else}
                        {msg.text}
                      {/if}
                    </div>
                  </div>
                {/each}
                {#if sidebarIsSending && sidebarStreamingText}
                  <div class="flex justify-start">
                    <div class="max-w-[90%] text-sm">
                      <Markdown text={sidebarStreamingText} />
                    </div>
                  </div>
                {:else if sidebarIsSending}
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner size={12} />
                    Thinking…
                  </div>
                {/if}
                <div bind:this={sidebarMessagesEnd}></div>
              </div>
            </div>

            <!-- Update recipe -->
            {#if activeSession.messages.some((m) => m.role === 'assistant')}
              <div class="shrink-0 border-t px-3 pt-3">
                <Button
                  variant="outline"
                  class="w-full"
                  onclick={handleSidebarApplyChanges}
                  loading={sidebarIsApplying}
                  disabled={sidebarIsApplying || sidebarIsSending}
                  data-testid="sidebar-apply-changes-btn"
                >
                  {#snippet leading()}<Icon name="RefreshCw" size={14} />{/snippet}
                  Update recipe
                </Button>
              </div>
            {/if}

            <!-- Input -->
            <div class="shrink-0 border-t p-3">
              <div class="flex items-end gap-2">
                <div
                  class="flex flex-1 items-start rounded-md border border-input bg-background px-3 text-sm focus-within:ring-2 focus-within:ring-ring {sidebarIsSending
                    ? 'opacity-50'
                    : ''}"
                >
                  <textarea
                    bind:this={sidebarInputEl}
                    class="flex-1 resize-none bg-transparent py-2 outline-none placeholder:text-muted-foreground"
                    rows={2}
                    placeholder="Message the chef…"
                    value={sidebarInputText}
                    onkeydown={handleSidebarKeydown}
                    oninput={handleSidebarInput}
                    disabled={sidebarIsSending}></textarea>
                </div>
                <Button
                  size="sm"
                  onclick={handleSidebarSend}
                  disabled={sidebarIsSending || !sidebarInputText.trim()}
                  loading={sidebarIsSending}
                  aria-label="Send"
                >
                  {#snippet leading()}<Icon name="SendHorizontal" size={14} />{/snippet}
                  Send
                </Button>
              </div>
            </div>
          {/if}
        </Card>
      </div>
    </div>
  </DetailPage>
{/if}

<!-- Add to shopping list review sheet -->
{#if recipe && $defaultListId}
  <RecipeAddToListSheet {recipe} listId={$defaultListId} bind:open={addToListOpen} />
{/if}

<!-- Regenerate image dialog: optional one-shot steer (issue #148) -->
<Dialog bind:open={regenOpen}>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="recipe-image-regenerate-dialog">
      <DialogHeader>
        <DialogTitle>Regenerate image</DialogTitle>
        <DialogDescription>
          Generate a fresh photo of this dish. Optionally add a steer — e.g. "make it brighter" or
          "show it in a rustic bowl".
        </DialogDescription>
      </DialogHeader>
      <TextField
        label="Steer (optional)"
        placeholder="e.g. warmer light, on a wooden board"
        value={regenHint}
        onValueChange={(v) => (regenHint = v)}
        data-testid="recipe-image-regenerate-hint"
      />
      <DialogFooter>
        <Button variant="outline" onclick={() => (regenOpen = false)} disabled={imageBusy}>
          Cancel
        </Button>
        <Button
          onclick={handleRegenerateConfirm}
          loading={imageBusy}
          disabled={imageBusy}
          data-testid="recipe-image-regenerate-confirm"
        >
          Regenerate
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>

<!-- Upload photo dialog: pick a local image → crop to 3:2 → Save (issue #455) -->
<Dialog bind:open={uploadOpen} onOpenChange={handleUploadOpenChange}>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="recipe-image-upload-dialog">
      <DialogHeader>
        <DialogTitle>Upload a photo</DialogTitle>
        <DialogDescription>
          Choose a photo from your device and position it in the 3:2 frame — drag to pan, scroll or
          use the slider to zoom.
        </DialogDescription>
      </DialogHeader>

      {#if uploadSrc}
        <ImageCropper bind:this={cropper} src={uploadSrc} />
        <button
          type="button"
          class="self-start text-xs text-primary hover:underline disabled:opacity-50"
          onclick={clearUploadSrc}
          disabled={uploadBusy}
          data-testid="recipe-image-upload-choose-another"
        >
          Choose a different photo
        </button>
      {:else}
        <label
          class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input px-4 py-10 text-sm text-muted-foreground hover:bg-muted/50"
        >
          <Icon name="ImagePlus" size={24} />
          <span>Tap to choose a photo</span>
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            onchange={handleUploadFileChange}
            data-testid="recipe-image-upload-input"
          />
        </label>
      {/if}

      <DialogFooter>
        <Button
          variant="outline"
          onclick={() => handleUploadOpenChange(false)}
          disabled={uploadBusy}
        >
          Cancel
        </Button>
        <Button
          onclick={handleUploadSave}
          loading={uploadBusy}
          disabled={uploadBusy || !uploadSrc}
          data-testid="recipe-image-upload-save"
        >
          Save
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
