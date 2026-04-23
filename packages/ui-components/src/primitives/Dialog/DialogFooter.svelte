<!-- spec: SPEC.md §8.6 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { DialogPartProps } from './Dialog.types';

  let { class: className, children }: DialogPartProps = $props();
</script>

<div class={cn('flex justify-end gap-2', className)}>
  {@render children?.()}
</div>
