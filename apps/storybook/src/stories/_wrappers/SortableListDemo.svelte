<!-- Composition wrapper for SortableList.stories.ts. SortableList is generic
     (<T>) and takes required `items` / `getId` / `onReorder` plus a `row` snippet
     — a single `component` + `args` cannot express it. The wrapper fixes a
     concrete item type, holds the list in `$state`, and reorders on drop. Drag is
     pointer-driven (svelte-dnd-action, imported inside the component — the wrapper
     stays Rule-7-clean and imports only @salt/ui-components); this is a
     static/interaction showcase. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { SortableList } from '@salt/ui-components';

  type Ingredient = { id: string; name: string };

  let items = $state<Ingredient[]>([
    { id: '1', name: 'Tinned tomatoes' },
    { id: '2', name: 'Olive oil' },
    { id: '3', name: 'Garlic' },
    { id: '4', name: 'Fresh basil' },
  ]);

  function getId(item: Ingredient): string {
    return item.id;
  }

  function onReorder(orderedIds: string[]): void {
    items = orderedIds
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is Ingredient => i !== undefined);
  }
</script>

<div class="w-80">
  <SortableList {items} {getId} {onReorder} class="space-y-2">
    {#snippet row(item)}
      <div
        class="flex cursor-grab items-center gap-2 rounded border border-border bg-card px-3 py-2"
      >
        <span aria-hidden="true" class="text-muted-foreground">⠿</span>
        <span class="text-sm font-medium">{item.name}</span>
      </div>
    {/snippet}
  </SortableList>
</div>
