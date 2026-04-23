<!-- spec: SPEC.md §5 v0.3 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { X } from 'lucide-svelte';
  import { cn } from '../../lib/cn';
  import type { SheetPartProps } from './Sheet.types';

  let { class: className, children }: SheetPartProps = $props();
</script>

<Dialog.Close
  class={cn(
    'salt-focus-ring inline-flex items-center justify-center rounded-md h-9 w-9 p-0 bg-transparent hover:bg-muted hover:text-foreground transition-colors motion-reduce:transition-none',
    className,
  )}
  aria-label="Close"
>
  {#if children}
    {@render children()}
  {:else}
    <X size={16} aria-hidden="true" />
  {/if}
</Dialog.Close>
