<!-- spec: SPEC.md §8.13 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { stackVariants } from './Stack.variants';
  import type { StackProps } from './Stack.types';

  let {
    gap = '4',
    align = 'stretch',
    justify = 'start',
    class: className,
    children,
  }: StackProps = $props();
</script>

<div class={cn(stackVariants({ gap, align, justify }), className)}>
  {@render children?.()}
</div>
