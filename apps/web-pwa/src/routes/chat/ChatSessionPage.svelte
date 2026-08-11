<script lang="ts">
  import { Button, DetailPage, Icon, Spinner } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { goBack } from '../../lib/nav.js';
  import { trackUsageEvent } from '@salt/observability';
  import { sessions, isLoadingSessions, claimRecipe } from '../../lib/chatService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { saveRecipe as saveRecipeDoc } from '@salt/firebase-sync';
  import { recipes, authorRecipeTraced } from '../../lib/recipeService.js';
  import {
    proposeRecipeAmendment,
    applyRecipeAmendment,
    type RecipeAmendment,
  } from '../../lib/recipeAmend.js';
  import type { ChatSessionDoc } from '@salt/domain/schemas';
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

  // Back goes where you came from. `goBack` uses real browser history first; this
  // route is only the fallback for a cold-launch straight into the chat (issue
  // #696: a chat that belongs to a recipe is reached FROM that recipe, so the
  // recipe — not the chat list — is the right door when there is no history).
  const backTo = $derived(session?.recipeId ? `/recipes/${session.recipeId}` : '/chat');

  // The dish a variation chat started from (issue #763) — resolved for the chip
  // and nothing else. A miss is the ordinary outcome for a base recipe that has
  // since been deleted, and simply drops the chip: the conversation carries on as
  // an ordinary chat and still saves.
  const basedOnRecipe = $derived(
    session?.basedOnRecipeId
      ? ($recipes.find((r) => r.id === session.basedOnRecipeId) ?? null)
      : null,
  );

  // Save as recipe — calls the librarian flow and navigates to the new recipe.
  let isSavingRecipe = $state(false);

  async function handleSaveAsRecipe(): Promise<void> {
    if (!session || isSavingRecipe) return;
    isSavingRecipe = true;
    const existingTags = [...new Set($recipes.flatMap((r) => r.metadata.tags))];
    // `basedOnRecipeId` grounds the librarian on the dish this conversation
    // started from, so a variation carries forward everything the chat never
    // mentioned. It stays the CREATE path: the flow assembles with no base
    // recipe, so the new dish gets its own title, its own hero image and no
    // "makes" link, and the original is untouched (issue #763).
    const result = await authorRecipeTraced({
      messages: session.messages,
      existingTags,
      basedOnRecipeId: session.basedOnRecipeId,
    });
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

  // Review changes — the review gate. Everything about what gets proposed and
  // what gets written lives in `recipeAmend` and is shared with the recipe
  // page's sidebar/drawer (issue #764); this page holds only its own busy/open
  // state, its toasts and where it goes afterwards. `isProposing` guards the AI
  // call; `isApplying` guards the eventual save.
  let isProposing = $state(false);
  let isApplying = $state(false);
  let summaryOpen = $state(false);
  // The pending proposal: the merged recipe ready to save + its diff for display.
  let pending = $state<RecipeAmendment | null>(null);

  async function handleReviewChanges(): Promise<void> {
    if (!session?.recipeId || isProposing) return;
    const existing = $recipes.find((r) => r.id === session!.recipeId);
    if (!existing) {
      addToast('Recipe not found.', 'destructive');
      return;
    }
    isProposing = true;
    const existingTags = [...new Set($recipes.flatMap((r) => r.metadata.tags))];
    const result = await proposeRecipeAmendment(existing, session.messages, existingTags);
    isProposing = false;
    if (result.kind !== 'ok') {
      addToast('Failed to generate recipe update.', 'destructive');
      return;
    }
    pending = result.value;
    summaryOpen = true;
  }

  // Apply changes — commit the pending proposal (the review gate's confirm).
  async function handleApplyChanges(): Promise<void> {
    if (!pending || isApplying) return;
    isApplying = true;
    const recipeId = pending.updated.id;
    const saveResult = await applyRecipeAmendment(pending);
    isApplying = false;
    if (saveResult.kind !== 'ok') {
      addToast('Failed to save recipe update.', 'destructive');
      return;
    }
    summaryOpen = false;
    pending = null;
    addToast('Recipe updated!', 'success');
    push(`/recipes/${recipeId}`);
  }

  // Discard / keep chatting — drop the proposal, write nothing.
  function handleDiscardChanges(): void {
    summaryOpen = false;
    pending = null;
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
  <DetailPage
    title={session.title}
    onBack={() => goBack(backTo)}
    backLabel="Back"
    class="p-4 sm:p-6"
  >
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

    <!-- "Based on: <dish>" (issue #763). The whole of what a variation chat needs to
         say about its origin: the recipe itself rides on the session and is read
         server-side, so the transcript stays a conversation instead of opening with a
         wall of pasted recipe text. A link, because the obvious next thing to want is
         to look at the dish you are varying. -->
    {#if basedOnRecipe}
      <button
        type="button"
        class="mb-3 inline-flex items-center gap-1.5 rounded bg-muted px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => push(`/recipes/${basedOnRecipe.id}`)}
        data-testid="chat-based-on-chip"
      >
        <Icon name="Sparkles" size={12} />
        Based on: {basedOnRecipe.title}
      </button>
    {/if}

    <ChatThread
      {session}
      {thread}
      layout="page"
      emptyText={basedOnRecipe
        ? `What would you change about ${basedOnRecipe.title}?`
        : 'Ask me anything about cooking.'}
    />
  </DetailPage>

  <!-- Review-and-approve gate for the pending AI edit (Phase 2) -->
  <RecipeChangeSummary
    diff={pending?.diff ?? null}
    bind:open={summaryOpen}
    applying={isApplying}
    onApply={handleApplyChanges}
    onDiscard={handleDiscardChanges}
  />
{/if}
