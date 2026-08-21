<script lang="ts">
  import { DisclosureChevron, DisclosureTrigger } from '@salt/ui-components';
  import { untrack } from 'svelte';

  let { startExpanded = false }: { startExpanded?: boolean } = $props();

  const CONTRIBUTORS = ['Ragù — 400g', 'Chilli — 200g', 'Shepherd’s pie — 250g'];

  let expanded = $state(untrack(() => startExpanded));
</script>

<!-- The shopping list's shape: the trigger is the label COLUMN of a row, with
     controls beside it that must stay outside the button, and the revealed
     content renders as a sibling of the row rather than a child of it
     (ui-spec-v09 §8.26.2). -->
<div class="flex flex-col gap-1">
  <div class="flex items-center gap-3 rounded border border-border bg-card px-3 py-2 text-sm">
    <div class="h-10 w-10 shrink-0 rounded bg-muted"></div>
    <DisclosureTrigger
      {expanded}
      class="min-w-0 flex-1 text-left"
      onclick={() => (expanded = !expanded)}
    >
      <span class="block truncate">Beef mince <span class="text-muted-foreground">×3</span></span>
      <span class="flex items-center gap-1 truncate text-xs text-muted-foreground/70">
        <DisclosureChevron {expanded} size={12} />
        {CONTRIBUTORS.length} recipes
      </span>
    </DisclosureTrigger>
    <div class="h-6 w-6 shrink-0 rounded-full border border-border"></div>
  </div>

  {#if expanded}
    <div class="flex flex-col gap-1 pb-1">
      {#each CONTRIBUTORS as c (c)}
        <div class="ml-6 rounded border border-border bg-background px-3 py-1.5 text-xs">{c}</div>
      {/each}
    </div>
  {/if}
</div>
