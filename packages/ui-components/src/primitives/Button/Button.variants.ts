// spec: SPEC.md §8.1 v0.2.3
import { cva, type VariantProps } from '../../lib/variants';

export const buttonVariants = cva('salt-button', {
  variants: {
    variant: {
      solid: 'salt-button--solid',
      outline: 'salt-button--outline',
      ghost: 'salt-button--ghost',
      link: 'salt-button--link',
      destructive: 'salt-button--destructive',
    },
    size: {
      sm: 'salt-button--sm',
      md: 'salt-button--md',
      lg: 'salt-button--lg',
      icon: 'salt-button--icon',
    },
    fullWidth: { true: 'salt-button--full', false: '' },
  },
  defaultVariants: { variant: 'solid', size: 'md', fullWidth: false },
});

export type ButtonVariants = VariantProps<typeof buttonVariants>;
