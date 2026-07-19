<!-- Composition wrapper for TopBar.stories.ts. TopBar has an optional `actions`
     Snippet slot that a single `component` + `args` cannot express, so a `withActions`
     boolean chooses whether the component is rendered with the actions snippet (its
     header only shows the actions region when the snippet is present). Rule 7: only
     @salt/ui-components. -->
<script lang="ts">
  import { TopBar, Button } from '@salt/ui-components';

  let {
    title = 'Salt',
    withActions = false,
    envLabel = undefined,
    envClass = undefined,
  }: {
    title?: string;
    withActions?: boolean;
    envLabel?: string;
    envClass?: string;
  } = $props();
</script>

<div class="w-full max-w-2xl overflow-hidden rounded-lg border border-border">
  {#if withActions}
    <TopBar {title} {envLabel} {envClass}>
      {#snippet actions()}
        <Button variant="ghost" size="sm">Help</Button>
        <Button variant="solid" size="sm">New</Button>
      {/snippet}
    </TopBar>
  {:else}
    <TopBar {title} {envLabel} {envClass} />
  {/if}
</div>
