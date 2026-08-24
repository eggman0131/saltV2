// spec: ui-spec-v08.md §8.22 v0.8
import { cva, type VariantProps } from '../../lib/variants';

export const dialVariants = cva('salt-dial', {
  variants: {
    size: {
      sm: 'salt-dial--sm',
      md: 'salt-dial--md',
      lg: 'salt-dial--lg',
    },
    tone: {
      /** The app's default voice — a cook's progress, a plain count. */
      neutral: 'salt-dial--neutral',
      /** Takes its colour from `--salt-dial-heat` on an ancestor. */
      heat: 'salt-dial--heat',
    },
  },
  defaultVariants: { size: 'md', tone: 'neutral' },
});

export type DialVariants = VariantProps<typeof dialVariants>;
