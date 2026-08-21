<script lang="ts">
  import CollapsibleSection from '../../src/primitives/CollapsibleSection/CollapsibleSection.svelte';
  import type { CollapsibleSectionProps } from '../../src/primitives/CollapsibleSection/CollapsibleSection.types';

  let { withAction = false, ...section }: { withAction?: boolean } & CollapsibleSectionProps =
    $props();
</script>

{#if withAction}
  <CollapsibleSection {...section}>
    {#snippet action()}
      <button type="button" data-testid="action">Clear</button>
    {/snippet}
    <button type="button" data-testid="body-button">A row</button>
  </CollapsibleSection>
{:else}
  <CollapsibleSection {...section}>
    <button type="button" data-testid="body-button">A row</button>
  </CollapsibleSection>
{/if}
