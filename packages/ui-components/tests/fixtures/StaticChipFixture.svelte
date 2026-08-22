<script lang="ts">
  import Chip from '../../src/primitives/Chip/Chip.svelte';
  import ChipGroup from '../../src/primitives/Chip/ChipGroup.svelte';
  import Icon from '../../src/primitives/Icon/Icon.svelte';

  let {
    label = 'Serves 4',
    variant = 'fact',
    withIcon = false,
  }: { label?: string; variant?: 'fact' | 'tag'; withIcon?: boolean } = $props();
</script>

{#snippet users()}
  <Icon name="Users" />
{/snippet}

<ChipGroup ariaLabel="Facts" data-testid="group">
  {#if variant === 'fact'}
    <Chip variant="fact" icon={withIcon ? users : undefined} data-testid="chip">{label}</Chip>
  {:else}
    <Chip variant="tag" data-testid="chip">{label}</Chip>
  {/if}
</ChipGroup>
