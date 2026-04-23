// spec: SPEC.md §6 v0.3
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
  duration?: number;
  variant?: ToastVariants['variant'];
  class?: string;
  children?: Snippet;
  onOpenChange?: (open: boolean) => void;
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
