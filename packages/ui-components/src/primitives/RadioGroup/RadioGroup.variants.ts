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

export const radioGroupItemVariants = cva('salt-control salt-control--radio', {
  variants: {
    disabled: {
      true: 'salt-control--disabled',
      false: '',
    },
  },
  defaultVariants: { disabled: false },
});

export const radioGroupIndicatorVariants = cva('salt-control--radio-indicator', {
  variants: {
    checked: {
      true: 'salt-control--radio-indicator-checked',
      false: 'salt-control--radio-indicator-unchecked',
    },
  },
  defaultVariants: { checked: false },
});

export type RadioGroupVariants = VariantProps<typeof radioGroupVariants>;
export type RadioGroupItemVariants = VariantProps<typeof radioGroupItemVariants>;
