<script lang="ts">
  import { Icon } from '@salt/ui-components';

  // A done step, folded to a compact row; tap to re-read it. Peeking is
  // NON-destructive — it expands the step, it does not untick it.
  //
  // THE ONE PLACE THE TWO COOK MODES DELIBERATELY LOOK DIFFERENT (issue #994), which
  // is exactly why the two classes arrive as PROPS rather than as a `mode` this file
  // branches on. Plain cook mode tints a done step with the teal primary; guided cook
  // recedes it into sage, so the live step is the only black-on-white thing on its
  // deck — sage because that is what a finished thing goes everywhere else in Salt
  // (the shopping list floods a ticked row with it). Both values are written out at
  // their call site, where the difference is visible to whoever is editing one of
  // them; a conditional in here is how you regress one mode while editing the other.

  interface Props {
    /** 0-based position in the recipe; the row prints `index + 1`. */
    index: number;
    text: string;
    /** The row's border + fill, e.g. `border-primary/40 bg-primary/5`. */
    accentClass: string;
    /** The "Step N" label's colour, e.g. `text-muted-foreground`. */
    labelClass: string;
    onPeek: () => void;
  }
  let { index, text, accentClass, labelClass, onPeek }: Props = $props();
</script>

<button
  type="button"
  class="mx-auto flex w-full max-w-2xl items-center gap-3 rounded-lg border {accentClass} px-4 py-3 text-left"
  onclick={onPeek}
  aria-expanded="false"
  data-testid="cook-step-collapsed"
>
  <span
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary bg-primary text-primary-foreground"
  >
    <Icon name="Check" size={18} />
  </span>
  <span class="shrink-0 text-xs font-semibold uppercase tracking-wide {labelClass}">
    Step {index + 1}
  </span>
  <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">
    {text}
  </span>
</button>
