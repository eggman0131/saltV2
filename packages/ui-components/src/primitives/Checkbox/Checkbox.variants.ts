// spec: SPEC.md §8.4 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const checkboxRootVariants = cva('salt-control salt-control--checkbox', {
  variants: {
    size: {
      sm: 'salt-control--checkbox-sm',
      md: 'salt-control--checkbox-md',
      lg: 'salt-control--checkbox-lg',
    },
  },
  defaultVariants: { size: 'md' },
});

export type CheckboxRootVariants = VariantProps<typeof checkboxRootVariants>;
