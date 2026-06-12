<script lang="ts">
  import { Button, DetailPage, Icon, Spinner } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { sessions, isLoadingSessions, sendMessage } from '../../lib/chatService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { callAuthorRecipe, saveRecipe as saveRecipeDoc } from '@salt/firebase-sync';
  import { recipes } from '../../lib/recipeService.js';
  import type { ChatSessionDoc } from '@salt/domain/schemas';

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
    // Scroll to bottom whenever messages or streaming text changes.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    session?.messages.length;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    streamingText;
    messagesEnd?.scrollIntoView({ behavior: 'smooth' });
  });

  async function handleSend(): Promise<void> {
    if (!session || !inputText.trim() || isSending) return;
    const text = inputText.trim();
    inputText = '';
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
    const result = await callAuthorRecipe({ messages: session.messages });
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

  // Apply changes — re-runs the librarian against the conversation and updates
  // the attached recipe in place (same id, original createdAt, new updatedAt).
  let isApplying = $state(false);

  async function handleApplyChanges(): Promise<void> {
    if (!session?.recipeId || isApplying) return;
    const existing = $recipes.find((r) => r.id === session!.recipeId);
    if (!existing) {
      addToast('Recipe not found.', 'destructive');
      return;
    }
    isApplying = true;
    const result = await callAuthorRecipe({ messages: session.messages });
    if (result.kind !== 'ok') {
      isApplying = false;
      addToast('Failed to generate recipe update.', 'destructive');
      return;
    }
    const draft = result.value;
    const now = new Date().toISOString();
    // Preserve the existing recipe's id and createdAt; bump updatedAt.
    const updated = {
      ...draft,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    const saveResult = await saveRecipeDoc(updated);
    isApplying = false;
    if (saveResult.kind !== 'ok') {
      addToast('Failed to save recipe update.', 'destructive');
      return;
    }
    addToast('Recipe updated!', 'success');
    push(`/recipes/${existing.id}`);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
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
    class="flex flex-col"
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
          onclick={handleApplyChanges}
          loading={isApplying}
          disabled={isApplying || isSending}
          data-testid="chat-apply-changes-btn"
        >
          {#snippet leading()}<Icon name="Check" size={16} />{/snippet}
          Apply changes
        </Button>
      {/if}
    {/snippet}
    <!-- Message list -->
    <div
      class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-6"
      data-testid="chat-messages"
    >
      {#if session.messages.length === 0 && !isSending}
        <p class="text-center text-sm text-muted-foreground py-12">
          Ask me anything about cooking.
        </p>
      {/if}

      {#each session.messages as msg (msg.id)}
        <div
          class="flex flex-col gap-1 {msg.role === 'user' ? 'items-end' : 'items-start'}"
          data-testid="chat-message-{msg.role}"
        >
          <div
            class="max-w-[85%] rounded-2xl px-4 py-2 text-sm {msg.role === 'user'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'}"
          >
            {msg.text}
          </div>
        </div>
      {/each}

      <!-- Streaming assistant reply in progress -->
      {#if isSending && streamingText}
        <div class="flex flex-col gap-1 items-start" data-testid="chat-message-streaming">
          <div class="max-w-[85%] rounded-2xl bg-muted px-4 py-2 text-sm text-foreground">
            {streamingText}<span class="animate-pulse">▌</span>
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

    <!-- Input bar -->
    <div class="border-t bg-background px-4 py-3 sm:px-6" data-testid="chat-input-bar">
      <div class="flex items-end gap-2">
        <textarea
          class="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          rows={1}
          placeholder="Message the chef…"
          bind:value={inputText}
          onkeydown={handleKeydown}
          disabled={isSending}
          data-testid="chat-input"
        ></textarea>
        <Button
          size="sm"
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
  </DetailPage>
{/if}
