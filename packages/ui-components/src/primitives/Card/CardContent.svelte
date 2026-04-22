<!-- spec: SPEC.md §8.9 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { CardContentProps } from './Card.types';

  let { class: className, children }: CardContentProps = $props();
</script>

<div class={cn('p-6 pt-0', className)}>
  {@render children?.()}
</div>
