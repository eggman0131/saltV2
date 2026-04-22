// spec: SPEC.md §8.1 v0.2.3
import type { Snippet } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';
import type { ButtonVariants } from './Button.variants';

export type ButtonProps = {
  variant?: ButtonVariants['variant'];
  size?: ButtonVariants['size'];
  fullWidth?: boolean;
  loading?: boolean;
  ariaLabel?: string;
  class?: string;
  leading?: Snippet;
  trailing?: Snippet;
  children?: Snippet;
  onclick?: HTMLButtonAttributes['onclick'];
} & Omit<HTMLButtonAttributes, 'class' | 'onclick'>;
