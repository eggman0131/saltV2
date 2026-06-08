// spec: SPEC.md §8.12 v0.2.3
import type { icons } from '@lucide/svelte';

export type IconProps = {
  name: keyof typeof icons;
  size?: number;
  ariaLabel?: string;
  class?: string;
};
