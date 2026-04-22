<!-- spec: SPEC.md §8.13 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { DividerProps } from './Divider.types';

  let { orientation = 'horizontal', class: className }: DividerProps = $props();
</script>

<div
  role="separator"
  aria-orientation={orientation}
  class={cn(
    orientation === 'horizontal' ? 'h-px w-full bg-border' : 'w-px h-full bg-border',
    className,
  )}
></div>
