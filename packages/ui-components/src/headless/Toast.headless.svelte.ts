// spec: SPEC.md §6 v0.3
import { createContext } from '../lib/context';

export type ToastVariant = 'default' | 'destructive' | 'success';

export type ToastProviderState = {
  readonly maxToasts: number;
};

export type ToastItemState = {
  close: () => void;
  readonly variant: ToastVariant;
};

export const TOAST_PROVIDER_CONTEXT = createContext<ToastProviderState>('ToastProvider');
export const TOAST_ITEM_CONTEXT = createContext<ToastItemState>('Toast');

export function createToastProviderState(opts: { maxToasts: () => number }): ToastProviderState {
  return {
    get maxToasts() {
      return opts.maxToasts();
    },
  };
}
