<!-- spec: SPEC.md §9.4 v0.2.3 -->
<script lang="ts" generics="T extends SelectableListItem">
  import { cn } from '../../lib/cn';
  import Checkbox from '../../primitives/Checkbox/Checkbox.svelte';
  import type { SelectableListItem, SelectableListProps } from './SelectableList.types';

  let {
    items,
    selected = $bindable(new Set<string>()),
    selectionMode = false,
    row,
    class: className,
  }: SelectableListProps<T> = $props();

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }
</script>

<ul class={cn('flex flex-col gap-1', className)}>
  {#each items as item (item.id)}
    {@const isSelected = selected.has(item.id)}
    <li
      class={cn(
        'flex items-center gap-3 px-3 py-2 rounded border border-border bg-card',
        isSelected && 'ring-2 ring-ring border-ring',
      )}
    >
      {#if selectionMode}
        <Checkbox checked={isSelected} onCheckedChange={() => toggle(item.id)} />
      {/if}
      <div class="flex-1 min-w-0">
        {@render row(item, { selected: isSelected, toggle: () => toggle(item.id) })}
      </div>
    </li>
  {/each}
</ul>
