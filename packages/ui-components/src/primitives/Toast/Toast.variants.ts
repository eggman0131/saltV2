// spec: SPEC.md §6 v0.3
import { cva, type VariantProps } from '../../lib/variants';

export const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between gap-4 overflow-hidden rounded-md border p-4 shadow-md transition-all motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default: 'border bg-background text-foreground',
        destructive: 'border-destructive bg-destructive text-destructive-foreground',
        success: 'border-secondary bg-secondary text-secondary-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type ToastVariants = VariantProps<typeof toastVariants>;
