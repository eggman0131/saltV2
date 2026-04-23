// spec: SPEC.md §2 v0.3
import { cva, type VariantProps } from '../../lib/variants';

export const radioGroupVariants = cva('flex gap-2', {
  variants: {
    orientation: {
      vertical: 'flex-col',
      horizontal: 'flex-row flex-wrap',
    },
  },
  defaultVariants: { orientation: 'vertical' },
});

export const radioGroupItemVariants = cva(
  'salt-focus-ring flex items-center gap-2 cursor-pointer rounded-sm outline-none',
  {
    variants: {
      disabled: {
        true: 'opacity-50 pointer-events-none cursor-not-allowed',
        false: '',
      },
    },
    defaultVariants: { disabled: false },
  },
);

export const radioGroupIndicatorVariants = cva(
  'h-4 w-4 shrink-0 rounded-full border border-primary flex items-center justify-center',
  {
    variants: {
      checked: {
        true: 'bg-primary',
        false: 'bg-background',
      },
    },
    defaultVariants: { checked: false },
  },
);

export type RadioGroupVariants = VariantProps<typeof radioGroupVariants>;
export type RadioGroupItemVariants = VariantProps<typeof radioGroupItemVariants>;
