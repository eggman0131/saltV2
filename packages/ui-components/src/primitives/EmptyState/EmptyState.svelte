<!-- spec: SPEC.md §8.25 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { EmptyStateProps } from './EmptyState.types';

  let { title, description, icon, actions, class: className }: EmptyStateProps = $props();
</script>

<div
  class={cn(
    'flex flex-col items-center justify-center text-center gap-3 py-12 px-6 rounded border border-dashed border-border',
    className,
  )}
  role="status"
>
  {#if icon}
    <div class="text-muted-foreground">
      {@render icon()}
    </div>
  {/if}
  <h3 class="text-base font-semibold text-foreground">{title}</h3>
  {#if description}
    <p class="text-sm text-muted-foreground max-w-md">{description}</p>
  {/if}
  {#if actions}
    <div class="flex items-center gap-2 mt-2">
      {@render actions()}
    </div>
  {/if}
</div>
