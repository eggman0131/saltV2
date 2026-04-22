<!-- spec: SPEC.md §8.13 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { inlineVariants } from './Inline.variants';
  import type { InlineProps } from './Inline.types';

  let {
    gap = '4',
    align = 'stretch',
    justify = 'start',
    class: className,
    children,
  }: InlineProps = $props();
</script>

<div class={cn(inlineVariants({ gap, align, justify }), className)}>
  {@render children?.()}
</div>
