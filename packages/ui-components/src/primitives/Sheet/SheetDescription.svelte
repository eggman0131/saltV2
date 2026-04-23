<!-- spec: SPEC.md §5 v0.3 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import type { SheetPartProps } from './Sheet.types';

  let { class: className, children }: SheetPartProps = $props();
</script>

<Dialog.Description class={cn('text-sm text-muted-foreground', className)}>
  {@render children?.()}
</Dialog.Description>
