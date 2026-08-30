// spec: ui-spec-v02.md §8.13 v0.2.19
import { cva, type VariantProps } from '../../lib/variants';
import { gapVariants } from '../../lib/layoutVariants';

export const gridVariants = cva('grid', {
  variants: {
    // One caller, so it stays here — unlike `gap`, which was three copies.
    cols: {
      1: 'grid-cols-1',
      2: 'grid-cols-2',
      3: 'grid-cols-3',
      4: 'grid-cols-4',
      6: 'grid-cols-6',
      12: 'grid-cols-12',
    },
    gap: gapVariants,
  },
  defaultVariants: { cols: 2, gap: '4' },
});

export type GridVariants = VariantProps<typeof gridVariants>;
