<!--
  One chef conversation: the transcript, the streaming placeholder, auto-scroll to
  the newest message and the composer. It is the ONLY implementation of any of
  those — the full chat page and the recipe page's chat column both render this,
  so a fix to either lands on both.

  What it deliberately does NOT own is anything that differs by host. "Save as
  recipe", "Review changes", "Open full chat" and the panel's card chrome are the
  host's to place; the hooks offered here are `aboveComposer`, a snippet dropped
  between the transcript and the input, and `aboveTranscript`, a snippet dropped
  INSIDE the panel's scroll box above the messages — so what the host puts there
  scrolls away with the conversation instead of costing it permanent height.
  There is no branching on which surface is rendering beyond `layout`, which is a
  layout choice and nothing more:

  - `page`  — the transcript scrolls with the document and the composer is a bar
              fixed above the bottom navigation (the /chat/:id route).
  - `panel` — the transcript scrolls inside its own box and the composer sits in
              flow beneath it, so the whole thing fits a column or a card.

  Live turn state (the partial reply, whether a send is in flight) lives in the
  `thread` controller the host passes in — see `chatThreadState.svelte.ts` for why
  it is not held here.
-->
<script lang="ts">
  import type { ChatSessionDoc } from '@salt/domain/schemas';
  import { Button, Icon, Markdown, Spinner } from '@salt/ui-components';
  import type { Snippet } from 'svelte';

  import type { ChatThreadState } from './chatThreadState.svelte.js';

  interface Props {
    session: ChatSessionDoc;
    thread: ChatThreadState;
    layout: 'page' | 'panel';
    /** Shown when the conversation is empty — the invitation, worded by the host. */
    emptyText: string;
    /**
     * Host actions that belong with the composer rather than the page header.
     * `| undefined` is `exactOptionalPropertyTypes`: a host that forwards its own
     * optional snippet has to be able to forward the one it does not have.
     */
    aboveComposer?: Snippet | undefined;
    /**
     * Host content that belongs at the TOP of the conversation and should scroll away
     * with it — the recipe page's list of chats (#737). Rendered inside the panel's
     * scroll box above the messages, so a long reply gets the column's full height and
     * the affordance is still there when you scroll back up. `panel` only: in `page`
     * layout the document scrolls and there is no box to put it in.
     *
     * Note the intended consequence: the auto-scroll-to-newest below scrolls this off
     * as soon as the conversation has content, and again when the host swaps sessions.
     */
    aboveTranscript?: Snippet | undefined;
  }
  let { session, thread, layout, emptyText, aboveComposer, aboveTranscript }: Props = $props();

  const panel = $derived(layout === 'panel');

  let inputText = $state('');
  let inputEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let messagesEnd = $state<HTMLDivElement | undefined>(undefined);
  let scrollBox = $state<HTMLDivElement | undefined>(undefined);

  $effect(() => {
    // Read these reactive values so the effect re-runs and scrolls to the bottom
    // whenever messages or streaming text change — and whenever the host swaps in
    // a different conversation.
    session.id;
    session.messages.length;
    thread.streamingText;
    if (panel) {
      // The panel scrolls ITSELF. `scrollIntoView` walks every scrollable ancestor,
      // so in a column beside a recipe it drags the page with it — and "the recipe
      // does not move when you pick another chat" is the point of docking it there.
      // Optional call: jsdom lays nothing out and ships no element scroller, so in the
      // unit suite there is genuinely nothing to scroll.
      scrollBox?.scrollTo?.({ top: scrollBox.scrollHeight, behavior: 'smooth' });
    } else {
      // On the full page the document IS the scroller, so this is the right tool.
      messagesEnd?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  async function handleSend(): Promise<void> {
    const text = inputText.trim();
    if (!text || thread.isSending) return;
    inputText = '';
    if (inputEl) inputEl.style.height = '';
    const ok = await thread.send(session, text);
    if (!ok) inputText = text;
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handleInput(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    inputText = el.value;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
</script>

{#snippet transcript()}
  {#if session.messages.length === 0 && !thread.isSending}
    <p class="text-center text-muted-foreground {panel ? 'py-8 text-xs' : 'py-12 text-sm'}">
      {emptyText}
    </p>
  {/if}

  {#each session.messages as msg (msg.id)}
    <div
      class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}"
      data-testid="chat-message-{msg.role}"
    >
      <div
        class="text-sm {panel ? 'max-w-[90%]' : 'max-w-[85%]'} {msg.role === 'user'
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

  {#if thread.isSending && thread.streamingText}
    <div class="flex justify-start" data-testid="chat-message-streaming">
      <div class="text-sm {panel ? 'max-w-[90%]' : 'max-w-[85%]'}">
        <Markdown text={thread.streamingText} />
      </div>
    </div>
  {:else if thread.isSending}
    <div class="flex items-center gap-2 text-muted-foreground {panel ? 'text-xs' : 'text-sm'}">
      <Spinner size={panel ? 12 : 14} />
      Thinking…
    </div>
  {/if}

  <div bind:this={messagesEnd}></div>
{/snippet}

{#snippet composer()}
  <div class="flex items-end {panel ? 'gap-2' : 'mx-auto max-w-2xl gap-3'}">
    <div
      class="flex flex-1 items-start rounded-md border border-input bg-background px-3 text-sm focus-within:ring-2 focus-within:ring-ring {thread.isSending
        ? 'opacity-50'
        : ''}"
    >
      <textarea
        bind:this={inputEl}
        class="flex-1 resize-none bg-transparent py-2 outline-none placeholder:text-muted-foreground"
        rows={panel ? 2 : 3}
        placeholder="Message the chef…"
        value={inputText}
        onkeydown={handleKeydown}
        oninput={handleInput}
        disabled={thread.isSending}
        data-testid="chat-input"></textarea>
    </div>
    <Button
      size={panel ? 'sm' : 'md'}
      onclick={handleSend}
      disabled={thread.isSending || !inputText.trim()}
      loading={thread.isSending}
      aria-label="Send"
      data-testid="chat-send-btn"
    >
      {#snippet leading()}<Icon name="SendHorizontal" size={panel ? 14 : 16} />{/snippet}
      Send
    </Button>
  </div>
{/snippet}

{#if panel}
  <div bind:this={scrollBox} class="min-h-0 flex-1 overflow-y-auto p-4">
    {@render aboveTranscript?.()}
    <div class="flex flex-col gap-3" data-testid="chat-messages">
      {@render transcript()}
    </div>
  </div>

  {@render aboveComposer?.()}

  <div class="shrink-0 border-t p-3">
    {@render composer()}
  </div>
{:else}
  <!-- pb-36 keeps the last message clear of the fixed input bar -->
  <div class="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-36" data-testid="chat-messages">
    {@render transcript()}
  </div>

  {@render aboveComposer?.()}

  <!-- Input bar — fixed above BottomNav on mobile, at viewport bottom on desktop -->
  <div
    class="fixed inset-x-0 bottom-14 z-20 border-t border-border bg-card px-4 py-3 lg:bottom-0"
    data-testid="chat-input-bar"
  >
    {@render composer()}
  </div>
{/if}
