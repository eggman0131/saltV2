// spec: SPEC.md §6 v0.3.1
import type { Snippet } from 'svelte';
import type { ToastVariant } from '../../headless/Toast.headless.svelte';
import type { ToastVariants } from './Toast.variants';

export type { ToastVariant };

export type ToastProviderProps = {
  children?: Snippet;
};

export type ToastViewportProps = {
  class?: string;
  children?: Snippet;
};

export type ToastProps = {
  open?: boolean;
  defaultOpen?: boolean;
  // `| undefined` so a toast may pass `duration: undefined` to mean "use the
  // provider default" under exactOptionalPropertyTypes.
  duration?: number | undefined;
  variant?: ToastVariants['variant'];
  class?: string;
  children?: Snippet;
  onOpenChange?: (open: boolean) => void;
  /**
   * Show a small circular ring that drains over `duration`, so the auto-dismiss
   * window is visible (used by the deferred-delete "Undo" snackbar). Opt-in and
   * default off, so every existing toast is unchanged. No effect when
   * `duration <= 0` (a toast with no auto-dismiss has nothing to count down). The
   * drain is CSS-driven and pauses in lock-step with the dismiss timer on hover;
   * under `prefers-reduced-motion: reduce` the ring is hidden (the timer + Undo
   * still work — only the visible drain is suppressed).
   */
  showCountdown?: boolean;
};

export type ToastPartProps = {
  class?: string;
  children?: Snippet;
};

export type ToastActionProps = {
  class?: string;
  children?: Snippet;
  onclick?: (e: MouseEvent) => void;
};
