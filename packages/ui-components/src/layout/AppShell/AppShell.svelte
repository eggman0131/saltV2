<script lang="ts">
  import { cn } from '../../lib/cn';
  import TopBar from '../TopBar/TopBar.svelte';
  import SideNav from '../SideNav/SideNav.svelte';
  import BottomNav from '../BottomNav/BottomNav.svelte';
  import type { AppShellProps } from './AppShell.types';

  let {
    navItems,
    currentPath,
    title = 'Salt',
    actions,
    sideNavFooter,
    class: className,
    children,
  }: AppShellProps = $props();
</script>

<div class={cn('flex min-h-screen flex-col bg-background text-foreground', className)}>
  <TopBar {title} {actions} />

  <div class="flex flex-1 overflow-hidden">
    <SideNav items={navItems} {currentPath} footer={sideNavFooter} />

    <!--
      pb-16: on mobile, reserves space so content is never hidden under the fixed BottomNav.
      lg:pb-0: removed on desktop where BottomNav is not rendered.
    -->
    <main class="flex-1 overflow-y-auto pb-14 lg:pb-0">
      {@render children?.()}
    </main>
  </div>

  <BottomNav items={navItems} {currentPath} />
</div>
