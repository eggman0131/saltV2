<!-- Composition wrapper for ListPage.stories.ts. ListPage is a template with many
     Snippet slots (children/loading/error/empty/selectionBar) plus state flags and
     a `bulkActions` array whose `icon` is a Lucide NAME string for the built-in
     Icon primitive — a single `component` + `args` cannot express that. The wrapper
     always provides the state snippets (ListPage only renders the one matching the
     active flag) and drives everything from plain boolean/number/text controls.
     Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { ListPage, EmptyState, ErrorState } from '@salt/ui-components';
  import type { BulkAction } from '@salt/ui-components';

  let {
    title = 'Shopping list',
    description = '',
    isLoading = false,
    isError = false,
    isEmpty = false,
    selectionMode = false,
    selectionCount = 0,
  }: {
    title?: string;
    description?: string;
    isLoading?: boolean;
    isError?: boolean;
    isEmpty?: boolean;
    selectionMode?: boolean;
    selectionCount?: number;
  } = $props();

  const items = ['Tinned tomatoes', 'Olive oil', 'Basmati rice', 'Free-range eggs', 'Sourdough'];

  // No-ops: the story is static; the actions are exercised in the app, not here.
  const noop = () => {};
  const bulkActions: BulkAction[] = [
    { id: 'check', label: 'Check', icon: 'Check', onSelect: noop },
    { id: 'delete', label: 'Delete', icon: 'Trash2', variant: 'destructive', onSelect: noop },
    {
      kind: 'picker',
      id: 'move',
      label: 'Move to…',
      icon: 'FolderInput',
      sheetTitle: 'Move items to…',
      targets: [
        { id: 'produce', label: 'Produce' },
        { id: 'pantry', label: 'Pantry' },
      ],
      onPick: noop,
    },
  ];
</script>

<div class="w-full max-w-2xl">
  <ListPage
    {title}
    {description}
    {isLoading}
    {isError}
    {isEmpty}
    {selectionMode}
    {selectionCount}
    {bulkActions}
  >
    {#snippet empty()}
      <EmptyState title="Your list is empty" description="Items you add will show up here." />
    {/snippet}
    {#snippet error()}
      <ErrorState />
    {/snippet}
    {#snippet selectionBar()}
      <span class="text-sm font-medium">{selectionCount} selected</span>
    {/snippet}
    <ul class="flex flex-col divide-y divide-border rounded border border-border">
      {#each items as item (item)}
        <li class="px-3 py-2 text-sm text-foreground">{item}</li>
      {/each}
    </ul>
  </ListPage>
</div>
