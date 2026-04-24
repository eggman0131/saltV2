// spec: SPEC.md §3 v0.3
import { cva, type VariantProps } from '../../lib/variants';

export const selectTriggerVariants = cva('salt-trigger', {
  variants: {
    disabled: {
      true: 'salt-trigger--disabled',
      false: 'salt-trigger--enabled',
    },
  },
  defaultVariants: { disabled: false },
});

export const selectContentVariants = cva(
  'min-w-32 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none',
);

export const selectItemVariants = cva(
  'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
  {
    variants: {
      active: {
        true: 'bg-accent text-accent-foreground',
        false: '',
      },
      disabled: {
        true: 'cursor-not-allowed opacity-50 pointer-events-none',
        false: '',
      },
    },
    defaultVariants: { active: false, disabled: false },
  },
);

export type SelectTriggerVariants = VariantProps<typeof selectTriggerVariants>;
export type SelectItemVariants = VariantProps<typeof selectItemVariants>;
