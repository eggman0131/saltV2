<!-- spec: SPEC.md §6 v0.3 -->
<script lang="ts">
  import { X } from 'lucide-svelte';
  import { cn } from '../../lib/cn';
  import { TOAST_ITEM_CONTEXT } from '../../headless/Toast.headless.svelte';
  import type { ToastPartProps } from './Toast.types';

  let { class: className, children }: ToastPartProps = $props();

  const ctx = TOAST_ITEM_CONTEXT.get();
</script>

<button
  type="button"
  aria-label="Close"
  class={cn(
    'salt-focus-ring absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md p-0 text-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 motion-reduce:transition-none group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50',
    className,
  )}
  onclick={ctx.close}
>
  {#if children}
    {@render children()}
  {:else}
    <X size={14} aria-hidden="true" />
  {/if}
</button>
