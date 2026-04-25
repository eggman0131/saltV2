<!-- spec: SPEC.md §9.4 v0.2.3 -->
<script lang="ts" generics="T extends SelectableListItem">
  import { cn } from '../../lib/cn';
  import Button from '../../primitives/Button/Button.svelte';
  import Checkbox from '../../primitives/Checkbox/Checkbox.svelte';
  import type { SelectableListItem, SelectableListProps } from './SelectableList.types';

  let {
    items,
    selected = $bindable(new Set<string>()),
    bulkActions = [],
    selectionLabel = (n: number) => `${n} selected`,
    row,
    class: className,
  }: SelectableListProps<T> = $props();

  const allSelected = $derived(items.length > 0 && items.every((i) => selected.has(i.id)));
  const someSelected = $derived(items.some((i) => selected.has(i.id)) && !allSelected);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function toggleAll() {
    selected = allSelected ? new Set() : new Set(items.map((i) => i.id));
  }

  function clearSelection() {
    selected = new Set();
  }

  function runBulk(action: (ids: string[]) => void) {
    action([...selected]);
    clearSelection();
  }
</script>

<div class={cn('flex flex-col gap-2', className)}>
  <div
    class="flex items-center justify-between px-3 py-2 rounded-md border border-border bg-muted/40"
  >
    <Checkbox
      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
      onCheckedChange={toggleAll}
      label={selected.size > 0 ? selectionLabel(selected.size) : 'Select all'}
    />
    {#if selected.size > 0}
      <div class="flex items-center gap-2">
        {#each bulkActions as action (action.id)}
          <Button
            variant={action.variant ?? 'outline'}
            size="sm"
            onclick={() => runBulk(action.onAction)}
          >
            {action.label}
          </Button>
        {/each}
        <Button variant="ghost" size="sm" onclick={clearSelection}>Clear</Button>
      </div>
    {/if}
  </div>

  <ul class="flex flex-col gap-1">
    {#each items as item (item.id)}
      {@const isSelected = selected.has(item.id)}
      <li
        class={cn(
          'flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-card',
          isSelected && 'ring-2 ring-ring border-ring',
        )}
      >
        <Checkbox checked={isSelected} onCheckedChange={() => toggle(item.id)} />
        <div class="flex-1 min-w-0">
          {@render row(item, { selected: isSelected, toggle: () => toggle(item.id) })}
        </div>
      </li>
    {/each}
  </ul>
</div>
