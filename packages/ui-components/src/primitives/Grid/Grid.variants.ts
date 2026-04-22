// spec: SPEC.md §8.13 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const gridVariants = cva('grid', {
  variants: {
    cols: {
      1: 'grid-cols-1',
      2: 'grid-cols-2',
      3: 'grid-cols-3',
      4: 'grid-cols-4',
      6: 'grid-cols-6',
      12: 'grid-cols-12',
    },
    gap: {
      '0': 'gap-0',
      '1': 'gap-1',
      '2': 'gap-2',
      '3': 'gap-3',
      '4': 'gap-4',
      '6': 'gap-6',
      '8': 'gap-8',
    },
  },
  defaultVariants: { cols: 2, gap: '4' },
});

export type GridVariants = VariantProps<typeof gridVariants>;
