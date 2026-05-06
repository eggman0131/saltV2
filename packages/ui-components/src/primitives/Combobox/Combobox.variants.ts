// spec: ui-spec-v04.md §3 v0.4
import { cva } from '../../lib/variants';

export const comboboxInputVariants = cva('salt-input salt-input--combobox');

export const comboboxTriggerVariants = cva(
  'flex h-10 min-h-0 items-center justify-center rounded-l-none rounded-r border border-l-0 border-input bg-background px-2 text-muted-foreground hover:bg-accent/50',
);

export const comboboxContentVariants = cva(
  'min-w-48 overflow-hidden rounded-b-md border border-border bg-popover text-popover-foreground shadow-md outline-none',
);

export const comboboxItemVariants = cva(
  'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
  {
    variants: {
      active: {
        true: 'bg-accent text-accent-foreground',
        false: '',
      },
    },
    defaultVariants: { active: false },
  },
);

export const comboboxCreateVariants = cva(
  'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm italic outline-none',
  {
    variants: {
      active: {
        true: 'bg-accent text-accent-foreground',
        false: '',
      },
    },
    defaultVariants: { active: false },
  },
);
