<!-- spec: SPEC.md §3 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { SelectSeparatorProps } from './Select.types';

  let { class: className }: SelectSeparatorProps = $props();
</script>

<div
  role="separator"
  aria-orientation="horizontal"
  class={cn('-mx-1 my-1 h-px bg-border', className)}
></div>
