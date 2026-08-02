// spec: SPEC.md §8.6 v0.2.9
import { cva, type VariantProps } from '../../lib/variants';

export const dialogOverlayClass =
  'fixed inset-0 z-dialog bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out fade-in-0 fade-out-0 duration-base ease-standard motion-reduce:animate-none';

// `w-full` and the mobile `max-w`/`max-h` clamps are load-bearing, not cosmetic.
// The panel is `position: fixed` with `left: 50%` and no `right`, so with `width:
// auto` CSS shrink-to-fit measures it against `100vw - left` — i.e. HALF the
// viewport. A `max-w-*` alone never fixes that: it is a ceiling, and the panel was
// already under it. Measured on a 393px phone, the photo-import dialog came out
// 221px wide — a little over half the screen, and unusable.
// So width is stated outright, the size scale only caps it from `sm` up, and below
// `sm` every dialog is `100% - 2rem` (a 1rem gutter each side once centred).
//
// The size classes are `sm:`-prefixed so tailwind-merge keeps the base clamp too —
// a modifier makes them a distinct key, where a bare `max-w-md` would win and drop
// the base back to full-bleed.
//
// Height is capped for the same reachability reason: a tall panel (the photo-import
// cropper is a portrait page) otherwise grows past the viewport with no way to
// scroll to the footer, so the primary action becomes unreachable. `dvh` because
// mobile browser chrome makes `vh` lie about the visible height.
export const dialogContentVariants = cva(
  'fixed left-1/2 top-1/2 z-dialog grid w-full max-w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-lg border bg-background p-6 shadow-dialog data-[state=open]:animate-in data-[state=closed]:animate-out fade-in-0 zoom-in-95 fade-out-0 zoom-out-95 duration-slow ease-emphasized motion-reduce:animate-none',
  {
    variants: {
      size: {
        sm: 'sm:max-w-sm',
        md: 'sm:max-w-md',
        lg: 'sm:max-w-2xl',
        xl: 'sm:max-w-4xl',
        // Already the base clamp — stated so the scale stays exhaustive.
        full: 'sm:max-w-[calc(100%-2rem)]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type DialogContentVariants = VariantProps<typeof dialogContentVariants>;
