// spec: SPEC.md §8.3 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const textareaFrameVariants = cva(
  'salt-focus-ring-within flex items-start gap-2 rounded-md border border-input bg-background h-auto',
  {
    variants: {
      size: {
        sm: 'px-3 text-sm min-h-8',
        md: 'px-4 text-sm min-h-9',
        lg: 'px-6 text-base min-h-10',
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

export type TextareaFrameVariants = VariantProps<typeof textareaFrameVariants>;
