<!-- spec: SPEC.md §6 v0.3.1 -->
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
    showCountdown = false,
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

  // Countdown-ring drain state. The ring is a pure-CSS animation over `duration`;
  // `paused` is the only reactive bit, flipped in lock-step with the dismiss timer
  // so the visible drain freezes exactly when the timer does on hover. (Reactive
  // because it drives an inline `animation-play-state`.)
  let paused = $state(false);

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
      paused = true;
    }
  }

  function resumeTimer() {
    paused = false;
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
  {@const showRing = showCountdown && (duration ?? 0) > 0}
  <div
    role={variant === 'destructive' ? 'alert' : 'status'}
    aria-live={variant === 'destructive' ? 'assertive' : 'polite'}
    aria-atomic="true"
    class={cn(toastVariants({ variant }), showRing && 'pl-12', className)}
    style={translateX > 0 ? `transform: translateX(${translateX}px)` : undefined}
    onmouseenter={pauseTimer}
    onmouseleave={resumeTimer}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
  >
    {#if showRing}
      <!--
        Leading drain ring. Kept OUT of flow (absolute) so the message/action
        justify-between layout is byte-identical to a ring-less toast; the root's
        `pl-12` opens the gutter it sits in. `currentColor` inherits the variant's
        text colour — no new tokens (theme:check stays green). `motion-reduce:hidden`
        drops the visible drain under reduced motion; the timer + Undo still work.
      -->
      <span
        class="pointer-events-none absolute left-4 top-1/2 flex -translate-y-1/2 items-center justify-center motion-reduce:hidden"
        data-testid="toast-countdown"
        aria-hidden="true"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <circle
            cx="10"
            cy="10"
            r="8"
            stroke="currentColor"
            stroke-opacity="0.2"
            stroke-width="2"
          />
          <circle
            class="toast-ring-progress"
            cx="10"
            cy="10"
            r="8"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            pathLength="1"
            transform="rotate(-90 10 10)"
            style="animation-duration: {duration}ms; animation-play-state: {paused
              ? 'paused'
              : 'running'};"
          />
        </svg>
      </span>
    {/if}
    {@render children?.()}
  </div>
{/if}

<style>
  /* Drain the ring from full to empty over `animation-duration` (set inline per
     toast). `pathLength="1"` normalises the arc so dasharray/offset are unitless.
     Svelte scopes both the keyframes and the animation-name reference below. */
  @keyframes toast-ring-drain {
    from {
      stroke-dashoffset: 0;
    }
    to {
      stroke-dashoffset: 1;
    }
  }

  .toast-ring-progress {
    stroke-dasharray: 1;
    animation-name: toast-ring-drain;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
</style>
