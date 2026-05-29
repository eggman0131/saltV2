<!-- spec: SPEC.md §9.1 v0.4.0 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import Spinner from '../../primitives/Spinner/Spinner.svelte';
  import EmptyState from '../../primitives/EmptyState/EmptyState.svelte';
  import ErrorState from '../../primitives/ErrorState/ErrorState.svelte';
  import Button from '../../primitives/Button/Button.svelte';
  import { LIST_PAGE_CONTEXT } from './ListPage.context.js';
  import type { ListPageProps } from './ListPage.types';

  let {
    title,
    description,
    toolbar,
    selectionBar,
    actions,
    isLoading = false,
    isError = false,
    isEmpty = false,
    loading,
    error,
    empty,
    children,
    class: className,
    ...restProps
  }: ListPageProps = $props();

  let selectionMode = $state(false);

  LIST_PAGE_CONTEXT.set({
    get selectionMode() {
      return selectionMode;
    },
    exitSelectionMode: () => {
      selectionMode = false;
    },
  });
</script>

<section class={cn('flex flex-col gap-4', className)} {...restProps}>
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex flex-col gap-1 min-w-0">
      <h1 class="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
      {#if description}
        <p class="text-sm text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if actions || selectionBar}
      <div class="flex items-center gap-2 shrink-0">
        {#if selectionBar}
          {#if selectionMode}
            <Button variant="ghost" size="sm" onclick={() => (selectionMode = false)}>Done</Button>
          {:else}
            <Button variant="ghost" size="sm" onclick={() => (selectionMode = true)}>Select</Button>
          {/if}
        {/if}
        {#if actions}
          {@render actions()}
        {/if}
      </div>
    {/if}
  </header>

  {#if toolbar}
    <div class="flex flex-wrap items-center gap-2">
      {@render toolbar()}
    </div>
  {/if}

  <div class="min-h-0">
    {#if isLoading}
      {#if loading}
        {@render loading()}
      {:else}
        <div class="flex items-center justify-center py-12">
          <Spinner size={24} />
        </div>
      {/if}
    {:else if isError}
      {#if error}
        {@render error()}
      {:else}
        <ErrorState />
      {/if}
    {:else if isEmpty}
      {#if empty}
        {@render empty()}
      {:else}
        <EmptyState title="Nothing here yet" />
      {/if}
    {:else}
      {#if selectionMode && selectionBar}
        <div
          class="mb-4 flex items-center justify-between px-3 py-2 rounded border border-border bg-muted/40"
        >
          {@render selectionBar()}
        </div>
      {/if}
      {#if children}
        {@render children()}
      {/if}
    {/if}
  </div>
</section>
