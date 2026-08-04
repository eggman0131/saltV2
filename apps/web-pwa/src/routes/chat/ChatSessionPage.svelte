<script lang="ts">
  import { Button, DetailPage, Icon, Spinner } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { trackUsageEvent } from '@salt/observability';
  import { sessions, isLoadingSessions, claimRecipe } from '../../lib/chatService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { saveRecipe as saveRecipeDoc } from '@salt/firebase-sync';
  import { recipes, authorRecipeTraced } from '../../lib/recipeService.js';
  import { diffRecipe, type Recipe } from '@salt/domain';
  import type { ChatSessionDoc, RecipeDiff } from '@salt/domain/schemas';
  import RecipeChangeSummary from '../recipes/RecipeChangeSummary.svelte';
  import ChatThread from './ChatThread.svelte';
  import { createChatThread } from './chatThreadState.svelte.js';

  interface Props {
    params: { id: string };
  }
  let { params }: Props = $props();

  const session = $derived(($sessions as ChatSessionDoc[]).find((s) => s.id === params.id) ?? null);

  // The transcript, the composer and the send path all live in ChatThread; this
  // page owns only the route lookup, the header actions and the review gate.
  const thread = createChatThread();

  // Back goes where you came from (issue #696). A chat that belongs to a recipe is
  // reached FROM that recipe — it is listed there — so returning to the chat list
  // was always the wrong door.
  const backTo = $derived(session?.recipeId ? `/recipes/${session.recipeId}` : '/chat');
  const backLabel = $derived(session?.recipeId ? 'Recipe' : 'Chef');

  // Save as recipe — calls the librarian flow and navigates to the new recipe.
  let isSavingRecipe = $state(false);

  async function handleSaveAsRecipe(): Promise<void> {
    if (!session || isSavingRecipe) return;
    isSavingRecipe = true;
    const existingTags = [...new Set($recipes.flatMap((r) => r.metadata.tags))];
    const result = await authorRecipeTraced({ messages: session.messages, existingTags });
    if (result.kind !== 'ok') {
      isSavingRecipe = false;
      addToast('Failed to generate recipe.', 'destructive');
      return;
    }
    const recipe = result.value;
    const now = new Date().toISOString();
    const stamped = { ...recipe, id: recipe.id, createdAt: now, updatedAt: now };
    const saveResult = await saveRecipeDoc(stamped);
    isSavingRecipe = false;
    if (saveResult.kind !== 'ok') {
      addToast('Failed to save recipe.', 'destructive');
      return;
    }
    trackUsageEvent('recipe.created', {
      recipe_id: stamped.id,
      recipe_kind: stamped.kind,
      recipe_method: 'chat',
    });
    // The conversation now belongs to the dish it produced, so it is listed on
    // that recipe and stops being swept away after a fortnight (issue #696).
    // Best-effort: the recipe is already saved and a failed claim must not read
    // as a failed save.
    await claimRecipe(session.id, stamped.id);
    addToast('Recipe saved!', 'success');
    push(`/recipes/${stamped.id}`);
  }

  // Review changes — re-runs the librarian against the conversation and shows a
  // diff summary (Phase 2 review gate). The AI draft becomes a PENDING proposal;
  // nothing is written until "Apply changes" in the summary sheet. `isProposing`
  // guards the AI call; `isApplying` guards the eventual save.
  let isProposing = $state(false);
  let isApplying = $state(false);
  let summaryOpen = $state(false);
  // The pending proposal: the merged recipe ready to save + its diff for display.
  let pendingUpdate = $state<Recipe | null>(null);
  let pendingDiff = $state<RecipeDiff | null>(null);

  async function handleReviewChanges(): Promise<void> {
    if (!session?.recipeId || isProposing) return;
    const existing = $recipes.find((r) => r.id === session!.recipeId);
    if (!existing) {
      addToast('Recipe not found.', 'destructive');
      return;
    }
    isProposing = true;
    const existingTags = [...new Set($recipes.flatMap((r) => r.metadata.tags))];
    const result = await authorRecipeTraced(
      {
        messages: session.messages,
        existingTags,
        recipeId: session.recipeId,
      },
      existing.title,
    );
    if (result.kind !== 'ok') {
      isProposing = false;
      addToast('Failed to generate recipe update.', 'destructive');
      return;
    }
    const draft = result.value;
    const now = new Date().toISOString();
    // Preserve the existing recipe's id and createdAt; bump updatedAt. The
    // librarian never returns an image or source (always null / manual), so
    // carry those over from the existing recipe too.
    const updated = {
      ...draft,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
      image: existing.image,
      source: existing.source,
    };
    // Diff on human-signal fields (machine-derived fields ignored by diffRecipe).
    pendingDiff = diffRecipe(existing, updated);
    pendingUpdate = updated;
    isProposing = false;
    summaryOpen = true;
  }

  // Apply changes — commit the pending proposal (the review gate's confirm).
  async function handleApplyChanges(): Promise<void> {
    if (!pendingUpdate || isApplying) return;
    isApplying = true;
    const saveResult = await saveRecipeDoc(pendingUpdate);
    isApplying = false;
    if (saveResult.kind !== 'ok') {
      addToast('Failed to save recipe update.', 'destructive');
      return;
    }
    const recipeId = pendingUpdate.id;
    summaryOpen = false;
    pendingUpdate = null;
    pendingDiff = null;
    addToast('Recipe updated!', 'success');
    push(`/recipes/${recipeId}`);
  }

  // Discard / keep chatting — drop the proposal, write nothing.
  function handleDiscardChanges(): void {
    summaryOpen = false;
    pendingUpdate = null;
    pendingDiff = null;
  }
</script>

{#if session === null}
  <div class="p-4 sm:p-6">
    {#if $isLoadingSessions}
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size={16} />
        Loading…
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">Chat not found.</p>
      <Button variant="outline" class="mt-4" onclick={() => push('/chat')}>Back to chats</Button>
    {/if}
  </div>
{:else}
  <DetailPage title={session.title} onBack={() => push(backTo)} {backLabel} class="p-4 sm:p-6">
    {#snippet actions()}
      {#if !session.recipeId && session.messages.some((m) => m.role === 'assistant')}
        <Button
          size="sm"
          variant="outline"
          onclick={handleSaveAsRecipe}
          loading={isSavingRecipe}
          disabled={isSavingRecipe || thread.isSending}
          data-testid="chat-save-recipe-btn"
        >
          {#snippet leading()}<Icon name="BookOpen" size={16} />{/snippet}
          Save as recipe
        </Button>
      {/if}
      {#if session.recipeId && session.messages.some((m) => m.role === 'assistant')}
        <Button
          size="sm"
          variant="outline"
          onclick={() => push(`/recipes/${session!.recipeId}`)}
          data-testid="chat-view-recipe-btn"
        >
          {#snippet leading()}<Icon name="BookOpen" size={16} />{/snippet}
          View recipe
        </Button>
        <Button
          size="sm"
          onclick={handleReviewChanges}
          loading={isProposing}
          disabled={isProposing || thread.isSending}
          data-testid="chat-apply-changes-btn"
        >
          {#snippet leading()}<Icon name="Check" size={16} />{/snippet}
          Review changes
        </Button>
      {/if}
    {/snippet}

    <ChatThread {session} {thread} layout="page" emptyText="Ask me anything about cooking." />
  </DetailPage>

  <!-- Review-and-approve gate for the pending AI edit (Phase 2) -->
  <RecipeChangeSummary
    diff={pendingDiff}
    bind:open={summaryOpen}
    applying={isApplying}
    onApply={handleApplyChanges}
    onDiscard={handleDiscardChanges}
  />
{/if}
