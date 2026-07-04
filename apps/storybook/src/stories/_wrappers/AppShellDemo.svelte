<!-- Composition wrapper for AppShell.stories.ts. AppShell is the full app frame
     (TopBar + SideNav + BottomNav + a `children` page) and needs a NavItem[] plus
     actions/sideNavFooter Snippet slots and page content that a single `component` +
     `args` cannot express. The shell is `h-dvh`; we pass class="h-full" (cn-merged so
     it wins) and bound it in a fixed-height frame for a self-contained snapshot. At
     desktop width the SideNav shows (lg:flex) and the BottomNav hides (lg:hidden).
     Rule 7: only @salt/ui-components (icons come via the shared navItems). -->
<script lang="ts">
  import { AppShell, Button } from '@salt/ui-components';
  import { demoNavItems } from './navItems';

  let {
    title = 'Salt',
    currentPath = '/recipes',
  }: {
    title?: string;
    currentPath?: string;
  } = $props();
</script>

<div class="h-[560px] w-full overflow-hidden rounded-lg border border-border">
  <AppShell navItems={demoNavItems} {currentPath} {title} class="h-full">
    {#snippet actions()}
      <Button variant="ghost" size="sm">Sign out</Button>
    {/snippet}
    {#snippet sideNavFooter()}
      <p class="text-xs text-muted-foreground">Signed in as chef@salt.app</p>
    {/snippet}
    <div class="p-6">
      <h1 class="text-h2 mb-2">Recipes</h1>
      <p class="text-body-md text-muted-foreground">
        The active page renders here inside the shell's scrollable main region, framed by the top
        bar and the side navigation.
      </p>
    </div>
  </AppShell>
</div>
