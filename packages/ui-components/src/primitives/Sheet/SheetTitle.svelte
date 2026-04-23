<!-- spec: SPEC.md §5 v0.3 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import type { SheetPartProps } from './Sheet.types';

  let { class: className, children }: SheetPartProps = $props();
</script>

<Dialog.Title class={cn('text-lg font-semibold text-foreground', className)}>
  {@render children?.()}
</Dialog.Title>
