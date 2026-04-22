// spec: SPEC.md §8.5 v0.2.3
import type { SwitchRootVariants } from './Switch.variants';

export type SwitchProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  label: string;
  description?: string;
  error?: string;
  size?: SwitchRootVariants['size'];
  class?: string;
  onCheckedChange?: (checked: boolean) => void;
};
