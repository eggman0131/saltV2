<!-- spec: SPEC.md §8.6 v0.2.3 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import type { DialogPartProps } from './Dialog.types';

  let { class: className, children }: DialogPartProps = $props();
</script>

<Dialog.Title class={cn('text-lg font-semibold text-foreground', className)}>
  {@render children?.()}
</Dialog.Title>
