<!-- Composition wrapper for SideNav.stories.ts. SideNav needs a NavItem[] and an
     optional `footer` Snippet slot that a single `component` + `args` cannot express.
     SideNav is `hidden ... lg:flex` (desktop-only); we pass class="flex" (cn-merged
     so it wins) to force it visible in isolation regardless of the canvas width, plus
     a height + frame border. A `withFooter` boolean chooses whether the component is
     rendered with the footer snippet. Rule 7: only @salt/ui-components (icons come
     via the shared navItems). -->
<script lang="ts">
  import { SideNav, Button } from '@salt/ui-components';
  import { demoNavItems } from './navItems';

  let {
    currentPath = '/recipes',
    withFooter = false,
  }: {
    currentPath?: string;
    withFooter?: boolean;
  } = $props();

  const frameClass = 'flex h-[480px] rounded-lg border border-border';
</script>

{#if withFooter}
  <SideNav items={demoNavItems} {currentPath} class={frameClass}>
    {#snippet footer()}
      <Button variant="ghost" size="sm">Sign out</Button>
    {/snippet}
  </SideNav>
{:else}
  <SideNav items={demoNavItems} {currentPath} class={frameClass} />
{/if}
