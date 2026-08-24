<!-- spec: ui-spec-v04.md §13.2, §17.3 v0.4 -->
<script lang="ts">
  import { Ellipsis } from '@lucide/svelte';
  import { cn } from '../../lib/cn';
  import Sheet from '../../primitives/Sheet/Sheet.svelte';
  import SheetContent from '../../primitives/Sheet/SheetContent.svelte';
  import SheetHeader from '../../primitives/Sheet/SheetHeader.svelte';
  import SheetTitle from '../../primitives/Sheet/SheetTitle.svelte';
  import SheetTrigger from '../../primitives/Sheet/SheetTrigger.svelte';
  import type { NavItem } from '../NavItem.types';
  import type { BottomNavProps } from './BottomNav.types';

  let {
    items,
    overflowItems = [],
    overflowLabel = 'More',
    currentPath,
    class: className,
  }: BottomNavProps = $props();

  let overflowOpen = $state(false);

  function isActive(href: string, path: string): boolean {
    const p = href.startsWith('#') ? href.slice(1) : href;
    if (p === '/') return path === '/';
    return path === p || path.startsWith(p + '/');
  }

  // The More tab stands in for everything folded behind it: it reads as selected
  // while the route lives in the overflow (otherwise nothing in the bar looks
  // active), and it carries the SUM of the overflow badges so a count — the Admin
  // needs-approval queue — is never silently hidden by being folded away.
  const overflowActive = $derived(overflowItems.some((i) => isActive(i.href, currentPath)));
  const overflowBadge = $derived(overflowItems.reduce((n, i) => n + (i.badge ?? 0), 0));
  const overflowTab = $derived<NavItem>({
    id: 'more',
    label: overflowLabel,
    icon: Ellipsis,
    href: '',
    ...(overflowBadge > 0 ? { badge: overflowBadge } : {}),
  });
</script>

<!--
  Active-indicator pill (Material 3 "navigation bar"). The selected tab is marked by
  a filled capsule behind its icon, not by colour alone — a shape cue is what stays
  legible under kitchen glare, at a glance, and for colour-blind users. It reuses
  `accent`/`accent-foreground`, which ARE M3's secondary-container/on-secondary-
  container pair (see salt.css), and which SideNav already uses for its active row,
  so mobile and desktop read the same. Because the pill now does the differentiating
  work, the inactive tabs no longer need to be washed out: they sit at
  `muted-foreground` (9.7:1 on the card) rather than the old `foreground/40`
  (~2.5:1, under the WCAG text minimum at 10px).
-->
{#snippet tab(item: NavItem, active: boolean)}
  {@const Icon = item.icon}
  <span
    class={cn(
      'relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-fast ease-standard',
      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
    )}
  >
    <Icon size={20} aria-hidden="true" />
    {#if item.badge}
      <!--
        Anchored to the pill's top edge, not above it: the row is only h-14, so a
        badge hung off the top would poke through the nav's border-t and float over
        the page content behind it.
      -->
      <span
        class="absolute -right-1 top-0 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground"
      >
        {item.badge}
      </span>
    {/if}
  </span>
  <span
    class={cn(
      'text-[10px] uppercase leading-none tracking-wider',
      active ? 'font-semibold text-foreground' : 'text-muted-foreground',
    )}
  >
    {item.label}
  </span>
{/snippet}

<nav
  class={cn(
    // pb-[env(safe-area-inset-bottom)]: keep the tappable row above the device
    // home indicator / gesture bar so the lower part of each icon isn't a dead zone.
    'fixed inset-x-0 bottom-0 z-10 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden',
    className,
  )}
  aria-label="Main navigation"
>
  <ul class="mx-auto flex h-14 w-full max-w-lg items-stretch justify-around" role="list">
    {#each items as item (item.id)}
      {@const active = isActive(item.href, currentPath)}
      <li class="flex flex-1">
        <a
          href={item.href}
          class="flex flex-1 flex-col items-center justify-center gap-1"
          aria-current={active ? 'page' : undefined}
        >
          {@render tab(item, active)}
        </a>
      </li>
    {/each}

    {#if overflowItems.length > 0}
      <li class="flex flex-1">
        <Sheet bind:open={overflowOpen} side="bottom">
          <SheetTrigger class="flex flex-1 flex-col items-center justify-center gap-1">
            {@render tab(overflowTab, overflowActive)}
          </SheetTrigger>
          <!--
            Hash navigation does not unmount the sheet, so each row closes it on
            click. pb keeps the last row clear of the gesture bar.
          -->
          <SheetContent
            class="max-h-[70dvh] gap-3 overflow-y-auto pb-[calc(1.5rem_+_env(safe-area-inset-bottom))]"
          >
            <SheetHeader>
              <SheetTitle>{overflowLabel}</SheetTitle>
            </SheetHeader>
            <ul class="flex flex-col gap-1" role="list">
              {#each overflowItems as item (item.id)}
                {@const active = isActive(item.href, currentPath)}
                {@const Icon = item.icon}
                <li>
                  <a
                    href={item.href}
                    onclick={() => (overflowOpen = false)}
                    class={cn(
                      'flex items-center gap-3 rounded px-3 py-3 transition-colors duration-fast ease-standard',
                      active ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span class="flex-1">{item.label}</span>
                    {#if item.badge}
                      <span
                        class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground"
                      >
                        {item.badge}
                      </span>
                    {/if}
                  </a>
                </li>
              {/each}
            </ul>
          </SheetContent>
        </Sheet>
      </li>
    {/if}
  </ul>
</nav>
