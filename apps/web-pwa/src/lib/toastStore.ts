import { writable } from 'svelte/store';
import type { Readable } from 'svelte/store';

export type ToastActionConfig = {
  label: string;
  onClick: () => void;
};

export type ToastItem = {
  id: string;
  message: string;
  variant: 'default' | 'destructive' | 'success';
  /** Optional action button rendered alongside the message (e.g. "Undo"). */
  action?: ToastActionConfig;
  /** Auto-dismiss duration in ms; falls back to the Toast component default when omitted. */
  duration?: number;
  /**
   * Called when the toast closes via timeout or the close button — but NOT when
   * the action button is pressed. Lets callers commit deferred work (e.g. a
   * delete) only if the user let the toast expire instead of undoing.
   */
  onDismiss?: () => void;
};

export type AddToastOptions = {
  action?: ToastActionConfig;
  duration?: number;
  onDismiss?: () => void;
};

const _toasts = writable<ToastItem[]>([]);
export const toasts: Readable<ToastItem[]> = _toasts;

export function addToast(
  message: string,
  variant: 'default' | 'destructive' | 'success' = 'default',
  options: AddToastOptions = {},
): string {
  const id = crypto.randomUUID();
  _toasts.update((ts) => [...ts, { id, message, variant, ...options }]);
  return id;
}

export function dismissToast(id: string): void {
  _toasts.update((ts) => ts.filter((t) => t.id !== id));
}
