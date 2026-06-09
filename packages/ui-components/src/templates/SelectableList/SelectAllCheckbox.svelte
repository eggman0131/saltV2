<!-- spec: ui-spec-v04.md §10 v0.4 -->
<!--
  Shared select-all control for a list's `selectionBar`. Reads everything it needs
  from the `ListSelection` controller so no page hand-rolls the
  allSelected/someSelected/toggleAll + count-label boilerplate.
-->
<script lang="ts">
  import Checkbox from '../../primitives/Checkbox/Checkbox.svelte';
  import type { ListSelection } from './listSelection.svelte.js';

  let { selection, ...rest }: { selection: ListSelection } & Record<string, unknown> = $props();
</script>

<Checkbox
  checked={selection.allSelected ? true : selection.someSelected ? 'indeterminate' : false}
  onCheckedChange={() => selection.toggleAll()}
  label={selection.count > 0 ? `${selection.count} selected` : 'Select all'}
  {...rest}
/>
