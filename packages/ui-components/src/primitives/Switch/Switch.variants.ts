// spec: SPEC.md §8.5 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const switchRootVariants = cva(
  'salt-focus-ring inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors motion-reduce:transition-none data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
  {
    variants: {
      size: {
        sm: 'h-4 w-7',
        md: 'h-5 w-9',
        lg: 'h-6 w-11',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export const switchThumbVariants = cva(
  'pointer-events-none block rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none data-[state=unchecked]:translate-x-0',
  {
    variants: {
      size: {
        sm: 'h-3 w-3 data-[state=checked]:translate-x-3',
        md: 'h-4 w-4 data-[state=checked]:translate-x-4',
        lg: 'h-5 w-5 data-[state=checked]:translate-x-5',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type SwitchRootVariants = VariantProps<typeof switchRootVariants>;
