<script lang="ts">
  import Chip from '../../src/primitives/Chip/Chip.svelte';
  import ChipGroup from '../../src/primitives/Chip/ChipGroup.svelte';
  import type { ChipGroupProps, ChipToggleProps } from '../../src/primitives/Chip/Chip.types';

  let {
    label = 'weeknight',
    ariaLabel,
    ...chip
  }: { label?: string; ariaLabel?: ChipGroupProps['ariaLabel'] } & ChipToggleProps = $props();
</script>

<ChipGroup {ariaLabel} data-testid="group">
  <Chip {...chip} data-testid="chip">{label}</Chip>
</ChipGroup>
