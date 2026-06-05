<!-- spec: ui-spec-v02.md §8.9 v0.2 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { CardProps } from './Card.types';

  let { class: className, children }: CardProps = $props();
</script>

<div class={cn('rounded border bg-card text-card-foreground shadow-sm', className)}>
  {@render children?.()}
</div>
