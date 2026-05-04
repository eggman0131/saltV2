// spec: SPEC.md §8.15 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const progressRootVariants = cva(
  'relative h-2 w-full overflow-hidden rounded-full bg-muted',
);

export const progressIndicatorVariants = cva('h-full bg-primary', {
  variants: {
    indeterminate: {
      true: 'w-1/3 animate-[salt-progress-indeterminate_1s_ease_infinite] motion-reduce:animate-none',
      false: 'transition-transform duration-base ease-standard motion-reduce:transition-none',
    },
  },
  defaultVariants: { indeterminate: false },
});

export type ProgressIndicatorVariants = VariantProps<typeof progressIndicatorVariants>;
