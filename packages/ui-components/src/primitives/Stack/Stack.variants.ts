// spec: ui-spec-v02.md §8.13 v0.2.19
import { cva, type VariantProps } from '../../lib/variants';
import { alignVariants, gapVariants, justifyVariants } from '../../lib/layoutVariants';

export const stackVariants = cva('flex flex-col', {
  variants: { gap: gapVariants, align: alignVariants, justify: justifyVariants },
  defaultVariants: { gap: '4', align: 'stretch', justify: 'start' },
});

export type StackVariants = VariantProps<typeof stackVariants>;
