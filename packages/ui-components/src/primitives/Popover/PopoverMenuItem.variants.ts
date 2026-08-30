// spec: ui-spec-v14.md §8.33 v0.14
import { cva, type VariantProps } from '../../lib/variants';

/**
 * One row of a popover menu (§8.33).
 *
 * The base is the string 28 call sites across four pages were writing by hand
 * (issue #930) — copied, and drifting: 26 sites at the #894 review, 28 a week
 * later.
 *
 * `disabled:opacity-50` lives in the BASE rather than in a variant keyed on the
 * `disabled` prop, and §8.33.5 says why: it is a `disabled:` variant utility, so
 * it selects `:disabled` and paints nothing on a row that is not disabled.
 * Making it conditional would make the dim depend on the author remembering to
 * ask for it, which is the hand-authoring accident this component ends.
 */
export const popoverMenuItemVariants = cva(
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'hover:bg-accent',
        // Replaces the neutral hover ground rather than adding to it: a
        // destructive row is destructive at rest, not only under the cursor.
        destructive: 'text-destructive hover:bg-destructive/10',
      },
      // Presentational only — no `aria-checked`, no `role="menuitemradio"`.
      // §8.33.6 states that limitation and what would have to change first.
      selected: { true: 'font-medium', false: '' },
    },
    defaultVariants: { variant: 'default', selected: false },
  },
);

export type PopoverMenuItemVariants = VariantProps<typeof popoverMenuItemVariants>;
