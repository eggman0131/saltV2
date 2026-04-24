// spec: SPEC.md §8.5 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const switchRootVariants = cva('salt-control salt-control--switch', {
  variants: {
    size: {
      sm: 'salt-control--switch-sm',
      md: 'salt-control--switch-md',
      lg: 'salt-control--switch-lg',
    },
  },
  defaultVariants: { size: 'md' },
});

export const switchThumbVariants = cva('salt-control--switch-thumb', {
  variants: {
    size: {
      sm: 'salt-control--switch-thumb-sm',
      md: 'salt-control--switch-thumb-md',
      lg: 'salt-control--switch-thumb-lg',
    },
  },
  defaultVariants: { size: 'md' },
});

export type SwitchRootVariants = VariantProps<typeof switchRootVariants>;
