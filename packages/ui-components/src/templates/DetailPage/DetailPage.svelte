<!-- spec: SPEC.md §9.3 v0.2.3; ui-spec-v07.md §1 v0.7 (fill) -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import Button from '../../primitives/Button/Button.svelte';
  import Icon from '../../primitives/Icon/Icon.svelte';
  import type { DetailPageProps } from './DetailPage.types';

  let {
    title,
    subtitle,
    onBack,
    backLabel = 'Back',
    actions,
    metadata,
    children,
    class: className,
    titleSlot,
    fill = false,
  }: DetailPageProps = $props();
</script>

<!--
  `fill` (ui-spec-v07 §1) makes the page occupy the shell's content area rather
  than grow with its content, so a child can own the scrolling. It is the same
  height chain ListPage's fill uses (ui-spec-v05 §1.2): `h-full` resolves against
  AppShell's <main>, which has a definite height (and, because <main> carries the
  bottom-nav padding, resolves to the space above the nav automatically);
  `min-h-0` is what lets the section shrink inside the flex column instead of
  being floored at its intrinsic content height. Since <main> is overflow-y-auto
  it then has nothing left to scroll — no change to AppShell, and no pixel
  arithmetic anywhere.

  `fill` and `metadata` are mutually exclusive (ui-spec-v07 §1.5): the metadata
  aside is `lg:sticky lg:top-4`, which presupposes the ancestor scroller `fill`
  removes. Declared, not enforced — no consumer wants both.
-->
<section class={cn('flex flex-col gap-6', className, fill && 'h-full min-h-0')}>
  <header class="flex flex-col gap-3">
    {#if onBack}
      <div>
        <Button variant="ghost" size="sm" onclick={onBack}>
          {#snippet leading()}
            <Icon name="ArrowLeft" size={16} />
          {/snippet}
          {backLabel}
        </Button>
      </div>
    {/if}
    <div class="flex flex-wrap items-start gap-3">
      <div class="flex flex-col gap-1 min-w-0">
        {#if titleSlot}
          {@render titleSlot()}
        {:else}
          <h1 class="text-2xl font-semibold tracking-tight text-foreground truncate">{title}</h1>
        {/if}
        {#if subtitle}
          <p class="text-sm text-muted-foreground">{subtitle}</p>
        {/if}
      </div>
      {#if actions}
        <!-- `ml-auto` keeps the actions right-aligned both inline with the title
             and when they wrap onto their own line; `justify-between` only did the
             former, letting a wrapped row fall back to flex-start (left). -->
        <div class="flex items-center gap-2 shrink-0 ml-auto">
          {@render actions()}
        </div>
      {/if}
    </div>
  </header>

  {#if metadata}
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_minmax(220px,_280px)] gap-6 items-start">
      <div class={cn('min-w-0', fill && 'flex min-h-0 flex-1 flex-col')}>
        {@render children?.()}
      </div>
      <aside class="flex flex-col gap-4 lg:sticky lg:top-4">
        {@render metadata()}
      </aside>
    </div>
  {:else}
    <div class={cn('min-w-0', fill && 'flex min-h-0 flex-1 flex-col')}>
      {@render children?.()}
    </div>
  {/if}
</section>
