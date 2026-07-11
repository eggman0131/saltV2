<script lang="ts">
  import { Button, DetailPage, Icon, Markdown, Spinner } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { sessions, isLoadingSessions, sendMessage } from '../../lib/chatService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { saveRecipe as saveRecipeDoc } from '@salt/firebase-sync';
  import { recipes, authorRecipeTraced } from '../../lib/recipeService.js';
  import { diffRecipe, type Recipe } from '@salt/domain';
  import type { ChatSessionDoc, RecipeDiff } from '@salt/domain/schemas';
  import RecipeChangeSummary from '../recipes/RecipeChangeSummary.svelte';

  interface Props {
    params: { id: string };
  }
  let { params }: Props = $props();

  const session = $derived(($sessions as ChatSessionDoc[]).find((s) => s.id === params.id) ?? null);

  // Live-streamed partial text for the assistant reply in progress.
  let streamingText = $state('');
  let isSending = $state(false);
  let inputText = $state('');

  let messagesEnd: HTMLDivElement | undefined = $state();

  $effect(() => {
    // Read these reactive values so the effect re-runs and scrolls to the bottom
    // whenever messages or streaming text change.
    session?.messages.length;
    streamingText;
    messagesEnd?.scrollIntoView({ behavior: 'smooth' });
  });

  async function handleSend(): Promise<void> {
    if (!session || !inputText.trim() || isSending) return;
    const text = inputText.trim();
    inputText = '';
    if (inputEl) inputEl.style.height = '';
    isSending = true;
    streamingText = '';

    const result = await sendMessage(session, text, (chunk) => {
      streamingText += chunk;
    });

    isSending = false;
    streamingText = '';

    if (result.kind !== 'ok') {
      addToast('Failed to send message.', 'destructive');
      inputText = text;
    }
  }

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

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  let inputEl: HTMLTextAreaElement | undefined = $state();

  function handleInput(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    inputText = el.value;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
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
    onBack={() => push('/chat')}
    backLabel="Chef"
    class="p-4 sm:p-6"
  >
    {#snippet actions()}
      {#if !session.recipeId && session.messages.some((m) => m.role === 'assistant')}
        <Button
          size="sm"
          variant="outline"
          onclick={handleSaveAsRecipe}
          loading={isSavingRecipe}
          disabled={isSavingRecipe || isSending}
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
          disabled={isProposing || isSending}
          data-testid="chat-apply-changes-btn"
        >
          {#snippet leading()}<Icon name="Check" size={16} />{/snippet}
          Review changes
        </Button>
      {/if}
    {/snippet}

    <!-- pb-36 keeps the last message clear of the fixed input bar -->
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-36" data-testid="chat-messages">
      {#if session.messages.length === 0 && !isSending}
        <p class="py-12 text-center text-sm text-muted-foreground">
          Ask me anything about cooking.
        </p>
      {/if}

      {#each session.messages as msg (msg.id)}
        <div
          class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}"
          data-testid="chat-message-{msg.role}"
        >
          <div
            class="max-w-[85%] text-sm {msg.role === 'user' ? 'rounded-lg bg-muted px-3 py-2' : ''}"
          >
            {#if msg.role === 'assistant'}
              <Markdown text={msg.text} />
            {:else}
              {msg.text}
            {/if}
          </div>
        </div>
      {/each}

      {#if isSending && streamingText}
        <div class="flex justify-start" data-testid="chat-message-streaming">
          <div class="max-w-[85%] text-sm">
            <Markdown text={streamingText} />
          </div>
        </div>
      {:else if isSending}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size={14} />
          Thinking…
        </div>
      {/if}

      <div bind:this={messagesEnd}></div>
    </div>
  </DetailPage>

  <!-- Input bar — fixed above BottomNav on mobile, at viewport bottom on desktop -->
  <div
    class="fixed inset-x-0 bottom-14 z-20 border-t border-border bg-card px-4 py-3 lg:bottom-0"
    data-testid="chat-input-bar"
  >
    <div class="mx-auto flex max-w-2xl items-end gap-3">
      <div
        class="flex flex-1 items-start rounded-md border border-input bg-background px-3 text-sm focus-within:ring-2 focus-within:ring-ring {isSending
          ? 'opacity-50'
          : ''}"
      >
        <textarea
          bind:this={inputEl}
          class="flex-1 resize-none bg-transparent py-2 outline-none placeholder:text-muted-foreground"
          rows={3}
          placeholder="Message the chef…"
          value={inputText}
          onkeydown={handleKeydown}
          oninput={handleInput}
          disabled={isSending}
          data-testid="chat-input"></textarea>
      </div>
      <Button
        onclick={handleSend}
        disabled={isSending || !inputText.trim()}
        loading={isSending}
        aria-label="Send"
        data-testid="chat-send-btn"
      >
        {#snippet leading()}<Icon name="SendHorizontal" size={16} />{/snippet}
        Send
      </Button>
    </div>
  </div>

  <!-- Review-and-approve gate for the pending AI edit (Phase 2) -->
  <RecipeChangeSummary
    diff={pendingDiff}
    bind:open={summaryOpen}
    applying={isApplying}
    onApply={handleApplyChanges}
    onDiscard={handleDiscardChanges}
  />
{/if}
