<!-- spec: ui-spec-v09.md §8.23 v0.9.2 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { chipVariants } from './Chip.variants';
  import type { ChipProps } from './Chip.types';

  let {
    variant = 'filter',
    pressed = false,
    icon,
    class: className,
    children,
    ...rest
  }: ChipProps = $props();

  // §8.23.8: `filter` and `expander` are buttons; `fact` and `tag` are spans,
  // because a thing that cannot be pressed must not be reachable by Tab or
  // announced as a control.
  const interactive = $derived(variant === 'filter' || variant === 'expander');
</script>

{#if interactive}
  <button
    type="button"
    class={cn(chipVariants({ variant, pressed }), className)}
    aria-pressed={variant === 'filter' ? pressed : undefined}
    {...rest}
  >
    {@render children?.()}
  </button>
{:else}
  <span class={cn(chipVariants({ variant, pressed: false }), className)} {...rest}>
    {@render icon?.()}
    {@render children?.()}
  </span>
{/if}
