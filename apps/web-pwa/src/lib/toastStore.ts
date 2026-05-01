import { writable } from 'svelte/store';
import type { Readable } from 'svelte/store';

export type ToastItem = {
  id: string;
  message: string;
  variant: 'default' | 'destructive' | 'success';
};

const _toasts = writable<ToastItem[]>([]);
export const toasts: Readable<ToastItem[]> = _toasts;

export function addToast(
  message: string,
  variant: 'default' | 'destructive' | 'success' = 'default',
): void {
  const id = crypto.randomUUID();
  _toasts.update((ts) => [...ts, { id, message, variant }]);
}

export function dismissToast(id: string): void {
  _toasts.update((ts) => ts.filter((t) => t.id !== id));
}
