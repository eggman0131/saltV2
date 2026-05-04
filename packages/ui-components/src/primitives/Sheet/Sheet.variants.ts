// spec: SPEC.md §5 v0.3
import { cva, type VariantProps } from '../../lib/variants';

export const sheetOverlayClass =
  'fixed inset-0 z-dialog bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out fade-in-0 fade-out-0 duration-base ease-standard motion-reduce:animate-none';

export const sheetContentVariants = cva(
  'fixed z-dialog flex flex-col gap-4 border bg-background p-6 shadow-dialog data-[state=open]:animate-in data-[state=closed]:animate-out duration-slow ease-emphasized motion-reduce:animate-none',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-full w-3/4 max-w-sm data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        left: 'inset-y-0 left-0 h-full w-3/4 max-w-sm data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        top: 'inset-x-0 top-0 w-full data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
        bottom:
          'inset-x-0 bottom-0 w-full data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export type SheetContentVariants = VariantProps<typeof sheetContentVariants>;
