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
    Markdown,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Spinner,
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
  import { createChatSession, sessions, sendMessage } from '../../lib/chatService.js';
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
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    activeSession?.messages.length;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
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

  import type { QuantityDoc } from '@salt/domain/schemas';
  function formatMetricQty(q: QuantityDoc): string {
    if (q.type === 'range') return `${q.min}–${q.max}`;
    if (q.type === 'single') return String(q.value);
    return String(q.whole + q.numerator / q.denominator);
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

      <div class="grid gap-4 lg:grid-cols-[2fr_1fr] lg:gap-6" data-testid="recipe-view">
        <!-- Left column: main recipe content -->
        <div class="flex flex-col gap-4">
          <!-- Description + meta chips -->
          {#if recipe.description || timeParts().length > 0 || recipe.metadata.tags.length > 0}
            <Card>
              <CardContent class="flex flex-col gap-3 p-4">
                {#if recipe.description}
                  <p class="text-sm text-muted-foreground">{recipe.description}</p>
                {/if}
                {#if timeParts().length > 0 || recipe.metadata.tags.length > 0}
                  <div class="flex flex-wrap items-center gap-2">
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
                        {ingredient.rawText}{#if ingredient.parsed?.displayText && ingredient.parsed?.quantity && ingredient.parsed?.unit}<span
                            class="ml-1 text-xs text-muted-foreground"
                            >({formatMetricQty(ingredient.parsed.quantity)}{ingredient.parsed
                              .unit})</span
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
                    <span class="mt-0.5 shrink-0 font-semibold text-muted-foreground"
                      >{idx + 1}</span
                    >
                    <div class="flex flex-1 flex-col gap-1">
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
                                class="whitespace-pre-wrap text-sm"
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
        <div class="hidden lg:sticky lg:top-4 lg:flex lg:flex-col lg:self-start">
          <Card class="flex flex-col overflow-hidden" style="height: calc(100dvh - 5.5rem)">
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
              <div class="flex-1 overflow-y-auto p-4">
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
                      disabled={sidebarIsSending}
                    ></textarea>
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
