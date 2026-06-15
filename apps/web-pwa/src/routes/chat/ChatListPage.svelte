<script lang="ts">
  import {
    Button,
    Icon,
    ListPage,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { auth } from '../../lib/auth.svelte.js';
  import {
    sessions,
    isLoadingSessions,
    createChatSession,
    removeSession,
  } from '../../lib/chatService.js';
  import { addToast } from '../../lib/toastStore.js';

  const sorted = $derived([...$sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

  let creating = $state(false);

  async function handleNew(): Promise<void> {
    const uid = auth.user?.uid;
    if (!uid) return;
    creating = true;
    const result = await createChatSession(uid, null);
    creating = false;
    if (result.kind !== 'ok') {
      addToast('Failed to create chat.', 'destructive');
      return;
    }
    push(`/chat/${result.value.id}`);
  }

  let deleteId = $state<string | null>(null);
  let deleteBusy = $state(false);

  async function handleDelete(): Promise<void> {
    if (!deleteId) return;
    deleteBusy = true;
    const result = await removeSession(deleteId);
    deleteBusy = false;
    deleteId = null;
    if (result.kind !== 'ok') {
      addToast('Failed to delete chat.', 'destructive');
    }
  }

  function formatDate(iso: string): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  }
</script>

<ListPage
  title="Chef"
  description="Ask your kitchen assistant anything."
  isLoading={$isLoadingSessions}
  isEmpty={sorted.length === 0}
  class="p-4 sm:p-6"
>
  {#snippet actions()}
    <Button
      size="sm"
      onclick={handleNew}
      loading={creating}
      disabled={creating}
      data-testid="chat-new-btn"
    >
      New chat
    </Button>
  {/snippet}

  {#snippet empty()}
    <div class="flex flex-col items-center gap-3 py-12 text-center">
      <p class="text-sm text-muted-foreground">No chats yet.</p>
      <Button size="sm" onclick={handleNew} loading={creating} disabled={creating}>
        Start your first chat
      </Button>
    </div>
  {/snippet}

  {#snippet children()}
    <ul class="flex flex-col gap-1" data-testid="chat-session-list">
      {#each sorted as session (session.id)}
        <li class="flex items-center gap-3 rounded border border-border bg-card px-3 py-2 text-sm">
          <button
            class="min-w-0 flex-1 text-left"
            onclick={() => push(`/chat/${session.id}`)}
            data-testid="chat-session-item"
          >
            <span class="block truncate font-medium">{session.title}</span>
            <span class="block text-xs text-muted-foreground">
              {formatDate(session.updatedAt)}{#if session.recipeId}
                · recipe{/if}
            </span>
          </button>
          <Button
            size="sm"
            variant="ghost"
            onclick={() => (deleteId = session.id)}
            aria-label="Delete chat"
          >
            <Icon name="Trash2" size={14} />
          </Button>
        </li>
      {/each}
    </ul>
  {/snippet}
</ListPage>

<Dialog
  open={deleteId !== null}
  onOpenChange={(v) => {
    if (!v) deleteId = null;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Delete chat?</DialogTitle>
        <DialogDescription>This action cannot be undone.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (deleteId = null)} disabled={deleteBusy}
          >Cancel</Button
        >
        <Button
          variant="destructive"
          onclick={handleDelete}
          loading={deleteBusy}
          disabled={deleteBusy}
          data-testid="chat-delete-confirm"
        >
          Delete
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
