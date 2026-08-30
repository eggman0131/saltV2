<!-- spec: ui-spec-v02.md §8.6 v0.2.18; ui-spec-v03.md §5.2 v0.3.5 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { DialogPartProps } from './Dialog.types';

  let { class: className, children }: DialogPartProps = $props();
</script>

<div class={cn('flex flex-col gap-1.5', className)}>
  {@render children?.()}
</div>
