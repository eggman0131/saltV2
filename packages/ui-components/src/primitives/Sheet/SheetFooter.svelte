<!-- spec: SPEC.md §5 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { SheetPartProps } from './Sheet.types';

  let { class: className, children }: SheetPartProps = $props();
</script>

<div class={cn('flex justify-end gap-2', className)}>
  {@render children?.()}
</div>
