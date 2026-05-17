// spec: SPEC.md §8.10 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const headingVariants = cva('font-display font-semibold tracking-tight text-foreground', {
  variants: {
    level: {
      1: 'text-display',
      2: 'text-h1',
      3: 'text-h2',
      4: 'text-body-lg',
      5: 'text-body-md',
      6: 'text-label-caps',
    },
  },
  defaultVariants: { level: 2 },
});

export type HeadingVariants = VariantProps<typeof headingVariants>;
