<!-- spec: ui-spec-v04.md §9 v0.4 -->
<script lang="ts" generics="T">
  import { dndzone, type DndEvent } from 'svelte-dnd-action';
  import type { SortableListProps } from './SortableList.types';

  type DndItem = { id: string; item: T };

  let { items, getId, onReorder, row, class: className }: SortableListProps<T> = $props();

  let dndItems = $state<DndItem[]>([]);
  let listEl = $state<HTMLUListElement | undefined>();

  $effect(() => {
    dndItems = items.map((item) => ({ id: getId(item), item }));
  });

  $effect(() => {
    const el = listEl;
    if (!el) return;

    function handleConsider(e: Event) {
      dndItems = (e as CustomEvent<DndEvent<DndItem>>).detail.items;
    }

    function handleFinalize(e: Event) {
      const { items: reordered } = (e as CustomEvent<DndEvent<DndItem>>).detail;
      dndItems = reordered;
      onReorder(reordered.map((d) => d.id));
    }

    el.addEventListener('consider', handleConsider);
    el.addEventListener('finalize', handleFinalize);
    return () => {
      el.removeEventListener('consider', handleConsider);
      el.removeEventListener('finalize', handleFinalize);
    };
  });
</script>

<ul bind:this={listEl} class={className} use:dndzone={{ items: dndItems, flipDurationMs: 150 }}>
  {#each dndItems as dndItem (dndItem.id)}
    <li>{@render row(dndItem.item)}</li>
  {/each}
</ul>
