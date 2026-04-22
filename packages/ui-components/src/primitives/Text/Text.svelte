<!-- spec: SPEC.md §8.11 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { textVariants } from './Text.variants';
  import type { TextProps } from './Text.types';

  let { as = 'p', size = 'md', muted = false, class: className, children }: TextProps = $props();
</script>

<svelte:element this={as} class={cn(textVariants({ size, muted }), className)}>
  {@render children?.()}
</svelte:element>
