<!-- spec: ui-spec-v04.md §11 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import Checkbox from '../../primitives/Checkbox/Checkbox.svelte';
  import type { EditableRowProps } from './EditableRow.types';

  let {
    selected = false,
    shaded = false,
    onToggleSelect,
    narrow,
    wide,
  }: EditableRowProps = $props();
</script>

<li
  class={cn(
    'flex items-center gap-3 rounded border px-3 py-2',
    shaded
      ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30'
      : 'border-border bg-card',
    selected && (shaded ? 'ring-2 ring-ring' : 'ring-2 ring-ring border-ring'),
  )}
>
  {#if onToggleSelect !== undefined}
    <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
  {/if}
  {#if narrow}
    <div class="flex-1 min-w-0 sm:hidden">
      {@render narrow()}
    </div>
  {/if}
  {#if wide}
    <div class="hidden sm:flex flex-1 min-w-0 items-center gap-2">
      {@render wide()}
    </div>
  {/if}
</li>
