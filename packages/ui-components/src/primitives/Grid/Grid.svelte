<!-- spec: SPEC.md §8.13 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { gridVariants } from './Grid.variants';
  import type { GridProps } from './Grid.types';

  let { cols = 2, gap = '4', class: className, children }: GridProps = $props();
</script>

<div class={cn(gridVariants({ cols, gap }), className)}>
  {@render children?.()}
</div>
