<!-- spec: SPEC.md §8.9 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { CardHeaderProps } from './Card.types';

  let { class: className, children }: CardHeaderProps = $props();
</script>

<div class={cn('flex flex-col gap-1.5 p-6', className)}>
  {@render children?.()}
</div>
