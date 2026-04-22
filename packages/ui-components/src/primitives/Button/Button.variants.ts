// spec: SPEC.md §8.1 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const buttonVariants = cva(
  'salt-focus-ring inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors motion-reduce:transition-none disabled:pointer-events-none data-[disabled]:opacity-50',
  {
    variants: {
      variant: {
        solid: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'bg-transparent hover:bg-muted hover:text-foreground',
        link: 'bg-transparent underline-offset-4 hover:underline text-primary',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-6 text-base',
        icon: 'h-9 w-9 p-0',
      },
      fullWidth: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'solid', size: 'md', fullWidth: false },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
