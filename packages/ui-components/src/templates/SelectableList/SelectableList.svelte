<!-- spec: ui-spec-v04.md §10 v0.4 -->
<script lang="ts" generics="T extends SelectableListItem">
  import { cn } from '../../lib/cn';
  import RowSelectCheckbox from './RowSelectCheckbox.svelte';
  import type { SelectableListItem, SelectableListProps } from './SelectableList.types';

  let {
    items,
    selection,
    getRowCheckboxLabel = (item: T) => `Select ${item.id}`,
    row,
    class: className,
  }: SelectableListProps<T> = $props();
</script>

<ul class={cn('flex flex-col gap-1', className)}>
  {#each items as item (item.id)}
    {@const isSelected = selection.isSelected(item.id)}
    <li
      class={cn(
        'flex items-center gap-3 px-3 py-2 rounded border border-border bg-card',
        isSelected && 'ring-2 ring-ring border-ring',
      )}
    >
      {#if selection.selectionMode}
        <RowSelectCheckbox
          {selection}
          id={item.id}
          aria-label={getRowCheckboxLabel(item)}
        />
      {/if}
      <div class="flex-1 min-w-0">
        {@render row(item, { selected: isSelected, toggle: () => selection.toggle(item.id) })}
      </div>
    </li>
  {/each}
</ul>
