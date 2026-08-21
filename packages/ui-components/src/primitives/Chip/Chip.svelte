<!-- spec: ui-spec-v09.md §8.23 v0.9 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { chipVariants } from './Chip.variants';
  import type { ChipProps } from './Chip.types';

  let {
    variant = 'filter',
    pressed = false,
    class: className,
    children,
    ...rest
  }: ChipProps = $props();
</script>

<button
  type="button"
  class={cn(chipVariants({ variant, pressed }), className)}
  aria-pressed={variant === 'filter' ? pressed : undefined}
  {...rest}
>
  {@render children?.()}
</button>
