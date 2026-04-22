// spec: SPEC.md §8.10 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const headingVariants = cva('font-semibold tracking-tight text-foreground', {
  variants: {
    level: {
      1: 'text-4xl',
      2: 'text-3xl',
      3: 'text-2xl',
      4: 'text-xl',
      5: 'text-lg',
      6: 'text-base',
    },
  },
  defaultVariants: { level: 2 },
});

export type HeadingVariants = VariantProps<typeof headingVariants>;
