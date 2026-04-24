// spec: SPEC.md §8.2 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const textFieldFrameVariants = cva('salt-input salt-focus-ring-within', {
  variants: {
    size: {
      sm: 'salt-input--sm',
      md: 'salt-input--md',
      lg: 'salt-input--lg',
    },
    error: {
      true: 'salt-input--error',
      false: '',
    },
    disabled: {
      true: 'salt-input--disabled',
      false: '',
    },
  },
  defaultVariants: { size: 'md', error: false, disabled: false },
});

export type TextFieldFrameVariants = VariantProps<typeof textFieldFrameVariants>;
