<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { TopBarProps } from './TopBar.types';

  let { title = 'Salt', actions, class: className }: TopBarProps = $props();
</script>

<header
  class={cn(
    'sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b bg-card px-4',
    className,
  )}
>
  <span class="text-base font-semibold tracking-tight text-foreground">{title}</span>
  {#if actions}
    <div class="flex items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</header>
