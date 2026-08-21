// spec: ui-spec-v09.md §8.23, §8.27 v0.9.1
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

/**
 * The value chip (§8.27) — a pill SURFACE, not a component.
 *
 * Applied via `class` to the control that already owns the interaction: a
 * `SelectTrigger`, a `ComboboxInput`, or a `TextField`'s frame (`frameClass`).
 * It is not a member of `chipVariants`' `variant` axis because `Chip` renders
 * its own `<button>` — a value chip inside one would be a button inside a
 * button — and because `.salt-chip` is a components-layer rule that loses the
 * cascade to `.salt-trigger` / `.salt-input`, while `salt-value-chip` is a
 * `@utility` and does not (§8.27.3).
 *
 * No variants and no sizes, by §8.27.8. It is a `cva` all the same, matching
 * `comboboxInputVariants` and every other single-class surface in this package,
 * so consumers import one shape whatever the class eventually grows into.
 */
export const valueChipVariants = cva('salt-value-chip');
