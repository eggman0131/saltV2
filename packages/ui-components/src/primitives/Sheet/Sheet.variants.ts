// spec: ui-spec-v03.md §5 v0.3
import { cva, type VariantProps } from '../../lib/variants';

export const sheetContentVariants = cva(
  'fixed z-dialog flex flex-col gap-4 border bg-background p-6 shadow-dialog data-[state=open]:animate-in data-[state=closed]:animate-out duration-slow ease-emphasized motion-reduce:animate-none',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-full w-3/4 max-w-sm data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        left: 'inset-y-0 left-0 h-full w-3/4 max-w-sm data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        top: 'inset-x-0 top-0 w-full data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
        // `bottom` is the only side the app actually uses — all eleven
        // `<SheetContent>` call sites in web-pwa pass it, and none passes
        // `right`, which is nonetheless the default (issue #930). It therefore
        // carries what every one of those eleven used to re-supply by hand: the
        // tighter phone padding that overrides the base `p-6`, and a height
        // ceiling without which a long sheet runs off the bottom of the screen
        // taking its confirm button with it. Per-side rather than on the base
        // string, because `right`/`left`/`top` want neither.
        //
        // The bottom padding adds `env(safe-area-inset-bottom)` deliberately: a
        // sheet flush to the bottom edge puts its last control under the iPhone
        // home bar, where the system swipe gesture eats the tap. The fixed part
        // is 1.5rem rather than the 2rem this used to be, so an unnotched screen
        // loses a little and a notched one gains the inset — the trade #930
        // Phase 3 was filed to make. Only `bottom` needs it; the other three
        // sides do not sit on that edge.
        bottom:
          'inset-x-0 bottom-0 w-full max-h-[85vh] p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export type SheetContentVariants = VariantProps<typeof sheetContentVariants>;
