<!-- spec: ui-spec-v04.md §2 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { ComboboxSeparatorProps } from './Combobox.types';

  let { class: className }: ComboboxSeparatorProps = $props();
</script>

<div
  role="separator"
  aria-orientation="horizontal"
  class={cn('-mx-1 my-1 h-px bg-border', className)}
></div>
