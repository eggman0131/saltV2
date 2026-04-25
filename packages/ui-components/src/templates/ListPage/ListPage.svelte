<!-- spec: SPEC.md §9.1 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import Spinner from '../../primitives/Spinner/Spinner.svelte';
  import EmptyState from '../../primitives/EmptyState/EmptyState.svelte';
  import ErrorState from '../../primitives/ErrorState/ErrorState.svelte';
  import type { ListPageProps } from './ListPage.types';

  let {
    title,
    description,
    toolbar,
    actions,
    isLoading = false,
    isError = false,
    isEmpty = false,
    loading,
    error,
    empty,
    children,
    class: className,
  }: ListPageProps = $props();
</script>

<section class={cn('flex flex-col gap-4', className)}>
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex flex-col gap-1 min-w-0">
      <h1 class="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
      {#if description}
        <p class="text-sm text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="flex items-center gap-2 shrink-0">
        {@render actions()}
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
    {:else if children}
      {@render children()}
    {/if}
  </div>
</section>
