<script lang="ts">
  import { Button, Icon, ListPage, TextField } from '@salt/ui-components';
  import type { KitchenMemoryDoc } from '@salt/domain/schemas';

  import {
    memories,
    isLoadingMemories,
    initKitchenMemorySync,
    rememberNote,
    forgetNote,
  } from '../../lib/kitchenMemoryService.js';
  import { formatInstant } from '../../lib/dateFormat.js';
  import { addToast } from '../../lib/toastStore.js';

  // "What I remember" (issue #816, phase 1) — `/chat/remembered`.
  //
  // The other half of `/remember`: everything the household has told the chef to
  // hold on to, in one place, addable and removable. An ordinary shell route — this
  // is reading and tidying, not a hands-full mode — so no entry in ./fullViewport.ts.
  //
  // GROUPED BY AUTHOR, because that is the question the page answers that a flat
  // list does not: these are two people's standing opinions about their own kitchen,
  // and "who said this" is most of what makes a note worth keeping or clearing.
  //
  // NO DELETE CONFIRMATION, deliberately unlike the chat list next door. A chat is
  // an unrecoverable transcript; a note is one sentence you can retype in five
  // seconds, and a dialog per note would make tidying up the tedious thing it exists
  // to avoid.

  // The page owns the subscription's lifetime — the house pattern (BatchListPage).
  // Phase 1's chef never reads these, so nothing wants them loaded at boot.
  $effect(() => initKitchenMemorySync());

  // Author groups in first-note order, notes newest-first inside each. Sorting the
  // groups by name would put the household in alphabetical order for no reason;
  // this way the list stays where it was as notes come and go.
  interface AuthorGroup {
    readonly author: string;
    readonly notes: readonly KitchenMemoryDoc[];
  }

  const grouped = $derived.by((): AuthorGroup[] => {
    const byAuthor = new Map<string, KitchenMemoryDoc[]>();
    for (const note of [...$memories].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const existing = byAuthor.get(note.author);
      if (existing) existing.push(note);
      else byAuthor.set(note.author, [note]);
    }
    return [...byAuthor].map(([author, notes]) => ({ author, notes }));
  });

  let draft = $state('');
  let saving = $state(false);

  async function handleAdd(): Promise<void> {
    const text = draft.trim();
    if (!text || saving) return;
    saving = true;
    const result = await rememberNote(text);
    saving = false;
    if (result.kind !== 'ok') {
      addToast('Failed to save that note.', 'destructive');
      return;
    }
    draft = '';
  }

  async function handleDelete(id: string): Promise<void> {
    const result = await forgetNote(id);
    if (result.kind !== 'ok') addToast('Failed to forget that note.', 'destructive');
  }

  function formatDate(iso: string): string {
    return formatInstant(new Date(iso), { month: 'short', day: 'numeric' }, undefined);
  }
</script>

<ListPage
  title="What I remember"
  description="Standing notes for the chef — how you cook, what you avoid, what your kitchen does."
  isLoading={$isLoadingMemories}
  isEmpty={grouped.length === 0}
  class="p-4 sm:p-6"
  data-testid="chat-memory-page"
>
  {#snippet toolbar()}
    <div class="flex w-full items-end gap-2">
      <TextField
        class="flex-1"
        label="Add a note"
        placeholder="We hate coriander"
        bind:value={draft}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleAdd();
          }
        }}
        data-testid="memory-add-input"
      />
      <Button
        onclick={handleAdd}
        loading={saving}
        disabled={saving || !draft.trim()}
        data-testid="memory-add-btn"
      >
        {#snippet leading()}<Icon name="Plus" size={16} />{/snippet}
        Add
      </Button>
    </div>
  {/snippet}

  {#snippet empty()}
    <div class="flex flex-col items-center gap-2 py-12 text-center" data-testid="memory-empty">
      <p class="text-sm text-muted-foreground">Nothing remembered yet.</p>
      <p class="max-w-sm text-sm text-muted-foreground">
        Add one above, or type <span class="font-mono">/remember something</span> in any chat with the
        chef.
      </p>
    </div>
  {/snippet}

  {#snippet children()}
    <div class="flex flex-col gap-6" data-testid="memory-groups">
      {#each grouped as group (group.author)}
        <section class="flex flex-col gap-2">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.author}
          </h2>
          <ul class="flex flex-col gap-1" data-testid="memory-list">
            {#each group.notes as note (note.id)}
              <li
                class="flex items-center gap-3 rounded border border-border bg-card px-3 py-2 text-sm"
                data-testid="memory-item"
              >
                <span class="min-w-0 flex-1">{note.text}</span>
                <span class="shrink-0 text-xs text-muted-foreground">
                  {formatDate(note.createdAt)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => handleDelete(note.id)}
                  aria-label="Forget this note"
                  data-testid="memory-delete-btn"
                >
                  <Icon name="Trash2" size={14} />
                </Button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/snippet}
</ListPage>
