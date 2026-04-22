// spec: SPEC.md §8.2 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const textFieldFrameVariants = cva(
  'salt-focus-ring-within flex items-center gap-2 rounded-md border border-input bg-background',
  {
    variants: {
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-6 text-base',
      },
      error: {
        true: 'border-destructive focus-within:ring-destructive',
        false: '',
      },
      disabled: {
        true: 'opacity-50 pointer-events-none',
        false: '',
      },
    },
    defaultVariants: { size: 'md', error: false, disabled: false },
  },
);

export type TextFieldFrameVariants = VariantProps<typeof textFieldFrameVariants>;
