<!-- spec: SPEC.md §9.3 v0.2.3 -->
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
  }: DetailPageProps = $props();
</script>

<section class={cn('flex flex-col gap-6', className)}>
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
    <div class="flex flex-wrap items-start justify-between gap-3">
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
        <div class="flex items-center gap-2 shrink-0">
          {@render actions()}
        </div>
      {/if}
    </div>
  </header>

  {#if metadata}
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_minmax(220px,_280px)] gap-6 items-start">
      <div class="min-w-0">
        {@render children?.()}
      </div>
      <aside class="flex flex-col gap-4 lg:sticky lg:top-4">
        {@render metadata()}
      </aside>
    </div>
  {:else}
    <div class="min-w-0">
      {@render children?.()}
    </div>
  {/if}
</section>
