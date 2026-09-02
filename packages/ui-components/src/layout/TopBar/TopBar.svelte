<!-- spec: ui-spec-v04.md §16.2 v0.4; ui-spec-v15.md §1.4 v0.15 (nav toggle) -->
<script lang="ts">
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import { cn } from '../../lib/cn';
  import Button from '../../primitives/Button/Button.svelte';
  import { SIDE_NAV_ID } from '../SideNav/SideNav.types';
  import type { TopBarProps } from './TopBar.types';

  let {
    title = 'Salt',
    actions,
    envLabel,
    envClass,
    navCollapsed = false,
    onToggleNav,
    class: className,
  }: TopBarProps = $props();
</script>

<header
  class={cn(
    'sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b px-4',
    // Non-prod environment banner: a bold coloured surface (supplied by the app)
    // replaces the default so staging/dev can never be mistaken for production.
    // The title, label and any text inherit this surface's text colour.
    envClass ?? 'bg-card',
    className,
  )}
>
  <!--
    The leading group. The bar is `justify-between`, so the toggle and the title
    have to travel together — two separate flex children would push the title to
    the middle and break the bar's shape on every page that has a control.
  -->
  <div class="flex min-w-0 items-center gap-2">
    {#if onToggleNav}
      <!--
        `hidden lg:inline-flex`: below `lg` there is no SideNav (it is itself
        `hidden … lg:flex`), so there is nothing to collapse and no control
        exists for a user at that width (ui-spec-v15 §1.4). The name says what
        pressing it DOES, and the glyph says which way it goes.

        `aria-controls` names a `<nav>` that is absent while collapsed. That is
        the correct shape for a disclosure whose content is unmounted:
        `aria-expanded="false"` is what says the region is not currently there.
        Keeping an empty nav rendered to satisfy the IDREF would reinstate the
        focusable-while-invisible defect the unmount exists to avoid (#641).
      -->
      <Button
        variant="ghost"
        size="sm"
        class="hidden lg:inline-flex"
        ariaLabel={navCollapsed ? 'Show navigation' : 'Hide navigation'}
        aria-expanded={!navCollapsed}
        aria-controls={SIDE_NAV_ID}
        onclick={onToggleNav}
      >
        {#if navCollapsed}
          <PanelLeftOpen size={18} aria-hidden="true" />
        {:else}
          <PanelLeftClose size={18} aria-hidden="true" />
        {/if}
      </Button>
    {/if}

    <span class="text-base font-semibold tracking-tight">{title}</span>
  </div>

  {#if envLabel}
    <!--
      Centred on the full bar width, independent of the title/actions on either
      side (the sticky header is the positioning context). pointer-events-none so
      it never intercepts clicks on the surrounding controls.
    -->
    <span
      class="pointer-events-none absolute left-1/2 -translate-x-1/2 text-sm font-bold uppercase tracking-widest"
    >
      {envLabel}
    </span>
  {/if}

  {#if actions}
    <div class="flex items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</header>
