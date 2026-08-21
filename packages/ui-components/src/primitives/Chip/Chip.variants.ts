// spec: ui-spec-v09.md §8.23 v0.9
import { cva, type VariantProps } from '../../lib/variants';

export const chipVariants = cva('salt-chip', {
  variants: {
    variant: {
      filter: 'salt-chip--filter',
      expander: 'salt-chip--expander',
    },
    // The pressed fill is written as its own class rather than folded into
    // `variant` so the two axes stay independent: `expander` simply has no rule
    // for `.salt-chip--on`, which is why a pressed expander paints nothing.
    pressed: { true: 'salt-chip--on', false: '' },
  },
  defaultVariants: { variant: 'filter', pressed: false },
});

export type ChipVariants = VariantProps<typeof chipVariants>;
