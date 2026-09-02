<!-- spec: ui-spec-v04.md §13.3, §16.3, §17.2 v0.4; ui-spec-v05.md §2.3 v0.5 (chrome); ui-spec-v15.md §1 v0.15 (navCollapsed) -->
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
    navCollapsed = $bindable(false),
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
    <!--
      The TopBar carries the collapse control, and it is the reason the control
      lives there rather than in the nav it hides: the TopBar is present at every
      width and in every state the SideNav can be in, so the way back is never
      inside the thing that just went away (ui-spec-v15 §1.4).
    -->
    <TopBar
      {title}
      {actions}
      {envLabel}
      {envClass}
      {navCollapsed}
      onToggleNav={() => (navCollapsed = !navCollapsed)}
    />
  {/if}

  <div class="flex flex-1 overflow-hidden">
    <!--
      Collapsed is NOT RENDERED, for the same reason `chrome={false}` is, and it
      composes with it here rather than adding a second visual mode: a nav that
      is merely hidden, `inert` or covered stays focusable and stays in the
      accessibility tree (issue #641, ui-spec-v15 §1.2). `<main>` is a `flex-1`
      sibling in this row, so the freed 256px goes to the page on its own — no
      page is told the nav collapsed and none needs to be.
    -->
    {#if chrome && !navCollapsed}
      <!-- Desktop has the vertical room for the full list; only the BottomNav overflows. -->
      <SideNav items={[...navItems, ...overflowNavItems]} {currentPath} footer={sideNavFooter} />
    {/if}

    <!--
      On mobile, reserve the BottomNav height plus the device safe-area inset so
      content is never hidden under the fixed BottomNav. The height is
      `--salt-layout-bottom-nav-height` (design.md `layout`) — the same token the
      nav itself reads, so the reservation cannot drift from what it reserves.
      lg:pb-0: removed on desktop where BottomNav is not rendered — as is the
      reservation itself when there is no chrome to clear.
    -->
    <main
      class={cn(
        'flex-1 overflow-y-auto',
        chrome &&
          'pb-[calc(var(--salt-layout-bottom-nav-height)_+_env(safe-area-inset-bottom))] lg:pb-0',
      )}
    >
      {@render children?.()}
    </main>
  </div>

  {#if chrome}
    <BottomNav items={navItems} overflowItems={overflowNavItems} {currentPath} />
  {/if}
</div>
