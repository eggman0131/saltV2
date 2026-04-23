// spec: SPEC.md §4 v0.3
import { cva, type VariantProps } from '../../lib/variants';

export const sliderRootVariants = cva('relative flex touch-none select-none', {
  variants: {
    orientation: {
      horizontal: 'w-full items-center',
      vertical: 'h-full flex-col justify-center',
    },
    disabled: {
      true: 'opacity-50 pointer-events-none',
      false: '',
    },
  },
  defaultVariants: { orientation: 'horizontal', disabled: false },
});

export const sliderTrackVariants = cva('relative grow rounded-full bg-muted overflow-visible', {
  variants: {
    orientation: {
      horizontal: 'h-2 w-full',
      vertical: 'w-2 h-full',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
});

export const sliderThumbVariants = cva(
  'absolute h-5 w-5 rounded-full border-2 border-primary bg-background shadow-sm salt-focus-ring cursor-grab active:cursor-grabbing transition-shadow',
  {
    variants: {
      disabled: {
        true: 'cursor-not-allowed',
        false: '',
      },
    },
    defaultVariants: { disabled: false },
  },
);

export type SliderRootVariants = VariantProps<typeof sliderRootVariants>;
export type SliderTrackVariants = VariantProps<typeof sliderTrackVariants>;
export type SliderThumbVariants = VariantProps<typeof sliderThumbVariants>;
