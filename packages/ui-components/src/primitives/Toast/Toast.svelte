<!-- spec: SPEC.md §6 v0.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { cn } from '../../lib/cn';
  import { TOAST_ITEM_CONTEXT } from '../../headless/Toast.headless.svelte';
  import { toastVariants } from './Toast.variants';
  import type { ToastProps } from './Toast.types';

  let {
    open = $bindable(),
    defaultOpen = false,
    duration = 5000,
    variant = 'default',
    class: className,
    children,
    onOpenChange,
  }: ToastProps = $props();

  if (open === undefined) open = untrack(() => defaultOpen);

  function close() {
    open = false;
    onOpenChange?.(false);
  }

  TOAST_ITEM_CONTEXT.set({
    close,
    get variant() {
      return variant ?? 'default';
    },
  });

  // Auto-dismiss timer state (plain let — not reactive, not tracked by effects)
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let remaining = untrack(() => duration);
  let timerStartTime: number | undefined;

  function clearTimer() {
    if (timerId !== undefined) {
      clearTimeout(timerId);
      timerId = undefined;
    }
  }

  function startTimer() {
    timerStartTime = Date.now();
    timerId = setTimeout(close, remaining);
  }

  function pauseTimer() {
    if (timerId !== undefined) {
      clearTimer();
      if (timerStartTime !== undefined) {
        remaining = Math.max(0, remaining - (Date.now() - timerStartTime));
      }
      timerStartTime = undefined;
    }
  }

  function resumeTimer() {
    if (remaining > 0) startTimer();
  }

  $effect(() => {
    if (!open || duration <= 0) return;
    remaining = duration;
    startTimer();
    return () => clearTimer();
  });

  // Swipe-to-dismiss state
  let translateX = $state(0);
  let pointerStartX = 0;
  let dragging = false;

  function onpointerdown(e: PointerEvent) {
    // Don't start a swipe (and don't capture the pointer) when the press lands
    // on an interactive control like the Undo action or the close button.
    // Capturing here retargets the resulting `click` to this container, so the
    // button's own onclick would never fire.
    if ((e.target as HTMLElement).closest('button')) return;
    pointerStartX = e.clientX;
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onpointermove(e: PointerEvent) {
    if (!dragging) return;
    const delta = e.clientX - pointerStartX;
    translateX = Math.max(0, delta);
  }

  function onpointerup(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    const delta = e.clientX - pointerStartX;
    if (delta > 50) {
      close();
    } else {
      translateX = 0;
    }
  }
</script>

{#if open}
  <div
    role={variant === 'destructive' ? 'alert' : 'status'}
    aria-live={variant === 'destructive' ? 'assertive' : 'polite'}
    aria-atomic="true"
    class={cn(toastVariants({ variant }), className)}
    style={translateX > 0 ? `transform: translateX(${translateX}px)` : undefined}
    onmouseenter={pauseTimer}
    onmouseleave={resumeTimer}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
  >
    {@render children?.()}
  </div>
{/if}
