// spec: SPEC.md §8.12 v0.2.11
import type { IconName } from './iconRegistry';

export type IconProps = {
  name: IconName;
  size?: number;
  ariaLabel?: string;
  class?: string;
};
