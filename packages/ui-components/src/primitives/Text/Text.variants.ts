// spec: SPEC.md §8.11 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const textVariants = cva('leading-normal', {
  variants: {
    size: {
      sm: 'text-label-caps',
      md: 'text-body-md',
      lg: 'text-body-lg',
    },
    muted: {
      true: 'text-muted-foreground',
      false: 'text-foreground',
    },
  },
  defaultVariants: { size: 'md', muted: false },
});

export type TextVariants = VariantProps<typeof textVariants>;
