<!-- spec: SPEC.md §6 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { ToastActionProps } from './Toast.types';

  let { class: className, children, onclick }: ToastActionProps = $props();
</script>

<button
  type="button"
  class={cn(
    'salt-focus-ring inline-flex shrink-0 items-center justify-center rounded border border-input bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary hover:text-secondary-foreground motion-reduce:transition-none group-[.destructive]:border-destructive/30 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground',
    className,
  )}
  {onclick}
>
  {@render children?.()}
</button>
