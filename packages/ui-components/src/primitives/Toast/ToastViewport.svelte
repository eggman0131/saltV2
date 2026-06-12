<!-- spec: SPEC.md §6 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { ToastViewportProps } from './Toast.types';

  let { class: className, children }: ToastViewportProps = $props();
</script>

<div
  class={cn(
    // pointer-events-none: the viewport spans a fixed, full-width strip at the
    // bottom (above the BottomNav in z-order) even when empty — without this it
    // swallows taps meant for the nav. Each Toast re-enables pointer-events-auto.
    'pointer-events-none fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 md:max-w-[420px]',
    className,
  )}
>
  {@render children?.()}
</div>
