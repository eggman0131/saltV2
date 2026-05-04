// spec: SPEC.md §8.6 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const dialogOverlayClass =
  'fixed inset-0 z-dialog bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out fade-in-0 fade-out-0 duration-base ease-standard motion-reduce:animate-none';

export const dialogContentVariants = cva(
  'fixed left-1/2 top-1/2 z-dialog grid -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-dialog data-[state=open]:animate-in data-[state=closed]:animate-out fade-in-0 zoom-in-95 fade-out-0 zoom-out-95 duration-slow ease-emphasized motion-reduce:animate-none',
  {
    variants: {
      size: {
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
        full: 'max-w-[calc(100vw-2rem)]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type DialogContentVariants = VariantProps<typeof dialogContentVariants>;
