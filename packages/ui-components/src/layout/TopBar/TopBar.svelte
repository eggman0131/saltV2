<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { TopBarProps } from './TopBar.types';

  let { title = 'Salt', actions, envLabel, envClass, class: className }: TopBarProps = $props();
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
  <span class="text-base font-semibold tracking-tight">{title}</span>

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
