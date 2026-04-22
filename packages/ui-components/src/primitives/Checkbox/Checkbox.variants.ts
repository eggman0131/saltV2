// spec: SPEC.md §8.4 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const checkboxRootVariants = cva(
  'salt-focus-ring peer shrink-0 rounded border border-input bg-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
  {
    variants: {
      size: {
        sm: 'h-3.5 w-3.5',
        md: 'h-4 w-4',
        lg: 'h-5 w-5',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type CheckboxRootVariants = VariantProps<typeof checkboxRootVariants>;
