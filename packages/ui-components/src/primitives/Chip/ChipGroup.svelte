<!-- spec: ui-spec-v09.md §8.24 v0.9 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { ChipGroupProps } from './Chip.types';

  let { ariaLabel, class: className, children, ...rest }: ChipGroupProps = $props();
</script>

<div
  class={cn('salt-chip-group', className)}
  role={ariaLabel === undefined ? undefined : 'group'}
  aria-label={ariaLabel}
  {...rest}
>
  {@render children?.()}
</div>
