<!-- spec: ui-spec-v04.md §13.3, §16.3, §17.2 v0.4; ui-spec-v05.md §2.3 v0.5 (chrome) -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import TopBar from '../TopBar/TopBar.svelte';
  import SideNav from '../SideNav/SideNav.svelte';
  import BottomNav from '../BottomNav/BottomNav.svelte';
  import type { AppShellProps } from './AppShell.types';

  let {
    navItems,
    overflowNavItems = [],
    currentPath,
    title = 'Salt',
    actions,
    envLabel,
    envClass,
    sideNavFooter,
    chrome = true,
    class: className,
    children,
  }: AppShellProps = $props();
</script>

<div class={cn('flex h-dvh flex-col bg-background text-foreground', className)}>
  <!--
    A full-viewport route (`chrome={false}`) does not render the navigation at all.
    Painting over it is not equivalent: covered chrome stays focusable and stays in
    the accessibility tree, which is what stranded keyboard focus on invisible
    navigation behind cook mode (issue #641). Not rendering removes it from both in
    one move, and is why no `inert` is needed here.
  -->
  {#if chrome}
    <TopBar {title} {actions} {envLabel} {envClass} />
  {/if}

  <div class="flex flex-1 overflow-hidden">
    {#if chrome}
      <!-- Desktop has the vertical room for the full list; only the BottomNav overflows. -->
      <SideNav items={[...navItems, ...overflowNavItems]} {currentPath} footer={sideNavFooter} />
    {/if}

    <!--
      On mobile, reserve the BottomNav height (h-14 = 3.5rem) plus the device
      safe-area inset so content is never hidden under the fixed BottomNav.
      lg:pb-0: removed on desktop where BottomNav is not rendered — as is the
      reservation itself when there is no chrome to clear.
    -->
    <main
      class={cn(
        'flex-1 overflow-y-auto',
        chrome && 'pb-[calc(3.5rem_+_env(safe-area-inset-bottom))] lg:pb-0',
      )}
    >
      {@render children?.()}
    </main>
  </div>

  {#if chrome}
    <BottomNav items={navItems} overflowItems={overflowNavItems} {currentPath} />
  {/if}
</div>
