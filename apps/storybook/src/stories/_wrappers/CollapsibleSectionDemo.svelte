<script lang="ts">
  import { Button, CollapsibleSection } from '@salt/ui-components';
  import { untrack } from 'svelte';

  let {
    title = 'Produce',
    withCount = true,
    withAction = false,
    startExpanded = true,
  }: {
    title?: string;
    withCount?: boolean;
    withAction?: boolean;
    startExpanded?: boolean;
  } = $props();

  const ROWS = ['Onions', 'Garlic', 'Flat-leaf parsley', 'Lemons'];

  // The page owns the open state (ui-spec-v09 §8.25.4) — the demo is the page.
  let expanded = $state(untrack(() => startExpanded));

  const collapsedCount = $derived(withCount ? ROWS.length : undefined);
</script>

<!-- Two call sites rather than a conditional `{#snippet}`: a snippet only
     becomes a component prop when it is an immediate child of the component. -->
{#snippet rows()}
  {#each ROWS as row (row)}
    <div class="flex items-center rounded border border-border bg-card px-3 py-2 text-sm">
      {row}
    </div>
  {/each}
{/snippet}

{#if withAction}
  <CollapsibleSection {title} {expanded} {collapsedCount} onToggle={() => (expanded = !expanded)}>
    {#snippet action()}
      <Button variant="outline" size="sm">Clear</Button>
    {/snippet}
    {@render rows()}
  </CollapsibleSection>
{:else}
  <CollapsibleSection {title} {expanded} {collapsedCount} onToggle={() => (expanded = !expanded)}>
    {@render rows()}
  </CollapsibleSection>
{/if}
