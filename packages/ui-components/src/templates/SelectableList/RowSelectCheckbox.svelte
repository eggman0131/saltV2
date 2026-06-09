<!-- spec: ui-spec-v04.md §10 v0.4 -->
<!--
  Shared per-row selection checkbox, wired to a `ListSelection` controller by id.
  Pages with bespoke row layouts (shopping, aisle) render this inside their own
  `{#if selectionMode}` gate instead of hand-rolling a `<Checkbox>` bound to a
  local `selected` Set. Extra attributes (aria-label, labelledBy, data-testid…)
  are forwarded to the underlying Checkbox.
-->
<script lang="ts">
  import Checkbox from '../../primitives/Checkbox/Checkbox.svelte';
  import type { ListSelection } from './listSelection.svelte.js';

  let {
    selection,
    id,
    ...rest
  }: { selection: ListSelection; id: string } & Record<string, unknown> = $props();
</script>

<Checkbox
  checked={selection.isSelected(id)}
  onCheckedChange={() => selection.toggle(id)}
  {...rest}
/>
