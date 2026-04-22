<!-- spec: SPEC.md §8.9 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { CardTitleProps } from './Card.types';

  let { class: className, children }: CardTitleProps = $props();
</script>

<div class={cn('text-lg font-semibold leading-none tracking-tight', className)}>
  {@render children?.()}
</div>
