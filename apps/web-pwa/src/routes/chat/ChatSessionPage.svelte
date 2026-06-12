<script lang="ts">
  import { Button, DetailPage, Icon, Spinner } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { sessions, isLoadingSessions, sendMessage } from '../../lib/chatService.js';
  import { addToast } from '../../lib/toastStore.js';
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
