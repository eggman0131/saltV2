<!-- spec: SPEC.md §8.6 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { DialogPartProps } from './Dialog.types';

  let { class: className, children }: DialogPartProps = $props();
</script>

<div class={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}>
  {@render children?.()}
</div>
