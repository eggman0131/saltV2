<!-- spec: SPEC.md §8.10 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { headingVariants } from './Heading.variants';
  import type { HeadingProps } from './Heading.types';

  let { level = 2, class: className, children }: HeadingProps = $props();
</script>

<svelte:element this={`h${level}`} class={cn(headingVariants({ level }), className)}>
  {@render children?.()}
</svelte:element>
