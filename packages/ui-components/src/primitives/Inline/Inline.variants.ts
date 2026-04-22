// spec: SPEC.md §8.13 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const inlineVariants = cva('flex flex-row', {
  variants: {
    gap: {
      '0': 'gap-0',
      '1': 'gap-1',
      '2': 'gap-2',
      '3': 'gap-3',
      '4': 'gap-4',
      '6': 'gap-6',
      '8': 'gap-8',
    },
    align: {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
    },
    justify: {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
      between: 'justify-between',
    },
  },
  defaultVariants: { gap: '4', align: 'stretch', justify: 'start' },
});

export type InlineVariants = VariantProps<typeof inlineVariants>;
