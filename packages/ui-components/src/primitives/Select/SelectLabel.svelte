<!-- spec: SPEC.md §3 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { SelectLabelProps } from './Select.types';

  let { class: className, children }: SelectLabelProps = $props();
</script>

<div class={cn('px-2 py-1 text-xs font-semibold text-muted-foreground', className)}>
  {@render children?.()}
</div>
