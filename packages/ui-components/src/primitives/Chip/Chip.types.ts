// spec: ui-spec-v09.md §8.23, §8.24 v0.9.4
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';
import type { IconName } from '../Icon/iconRegistry';

/**
 * The attribute passthrough shared by all four variants: `onclick`,
 * `data-testid`, `data-*`, `title`, `id`, `aria-*`.
 *
 * `HTMLAttributes<HTMLElement>`, NOT `HTMLButtonAttributes` as v0.9 had it —
 * two of the four variants render a `<span>` (§8.23.8), and a passthrough that
 * advertised `disabled`, `type` or `form` would be offering a page attributes
 * the element it lands on cannot honour. Nothing is lost: `disabled` was the
 * only button-only attribute v0.9 §8.23.3 named, §8.23.7 has always said a chip
 * has no disabled treatment, and no call site passed one.
 *
 * One base for every member also keeps the union small enough to survive
 * `Meta<typeof Chip>` in Storybook — a union of `HTMLButtonAttributes` and
 * `HTMLAttributes<HTMLSpanElement>` is "too complex to represent" there.
 */
type ChipAttributes = Omit<HTMLAttributes<HTMLElement>, 'class'>;

/**
 * The `fact`-only tint axis (§8.23.9). Named for the palette role, never for
 * what the role is being used to mean: `Chip` does not know what a recipe is,
 * and a `tone="duration"` would put the consumer's vocabulary inside the
 * primitive and be wrong for the next consumer.
 */
export type ChipTone = 'neutral' | 'primary' | 'secondary' | 'tertiary';

/**
 * The two pressable chips: `filter` (the toggle) and `expander` (the dashed
 * "+N more" / "Show less"). Both render `<button type="button">`, and
 * `onclick`, `data-testid` and the rest ride `...rest` onto it (§8.23.3).
 */
export type ChipToggleProps = {
  variant?: 'filter' | 'expander';
  /**
   * The toggle state, rendered as `aria-pressed`. Ignored by `expander`, which
   * is an action rather than a state (§8.23.6).
   */
  pressed?: boolean;
  /** Not available here: only `fact` carries an icon (§8.23.7). */
  icon?: never;
  /** Not available here: only `fact` is tinted (§8.23.9). */
  tone?: never;
  /** The chip's label, and its accessible name. Text only. */
  children?: Snippet;
  class?: string;
} & ChipAttributes;

/**
 * `fact` — a measured attribute of the thing being read: "Serves 4",
 * "Prep 40 min". Tinted ground, optional leading icon, renders a `<span>`
 * (§8.23.8).
 */
export type ChipFactProps = {
  variant: 'fact';
  /** Not available here: nothing static has a pressed state (§8.23.6). */
  pressed?: never;
  /**
   * A leading glyph, **named** rather than drawn: `Chip` renders
   * `<Icon name={icon} size={12} />` itself (§8.23.8, amended v0.9.4).
   *
   * It was a `Snippet` held to 12px by `.salt-chip--fact svg`, and that
   * selector was the whole guarantee. `CanonIcon` renders a `<span>` around an
   * `<img>`, which the selector never matched, so a pictogram in this slot
   * sized itself — an 18px nominal tile painting a 15 × 9 px smudge (#955).
   * TypeScript cannot see inside a `Snippet`, so a name from the closed
   * registry is the only way to make that unrepresentable rather than merely
   * discouraged (#1051). A picture with words belongs in `PictogramPill`
   * (v0.12 §8.30).
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`, so a caller
   * whose glyph is conditional can pass it straight through — the recipe page's
   * attribution fact has no honest glyph and passes `undefined`.
   */
  icon?: IconName | undefined;
  /**
   * Which hue the tint is, so a row of facts reads as several kinds of thing
   * (§8.23.9). Palette roles, not meanings — what each hue names is the page's
   * to decide and to document. Defaults to `neutral`, which is the plain
   * `bg-muted` fact this variant has always been.
   */
  tone?: ChipTone;
  children?: Snippet;
  class?: string;
} & Omit<ChipAttributes, 'onclick'> & { onclick?: never };

/**
 * `tag` — a word someone attached to the thing, not measured from it. Quiet
 * outline, no icon, renders a `<span>` (§8.23.8).
 */
export type ChipTagProps = {
  variant: 'tag';
  pressed?: never;
  /** Not available here: an icon beside an arbitrary word would be a guess. */
  icon?: never;
  /** Not available here: a tag is one kind of thing, so it has one look. */
  tone?: never;
  children?: Snippet;
  class?: string;
} & Omit<ChipAttributes, 'onclick'> & { onclick?: never };

/**
 * A discriminated union on `variant`, so a `fact` chip cannot be handed
 * `pressed`, a `tag` cannot be handed an `icon` or a `tone`, and neither can be
 * handed an `onclick`.
 *
 * Every member declares every Salt-owned prop — the disallowed ones as
 * `never` — which is what keeps the union destructurable inside `Chip.svelte`
 * (`$props()` must be annotated with the exported type, or the constraint would
 * never reach a call site). Safe here because no consumer picks `variant`
 * dynamically; all five call sites pass a literal.
 */
export type ChipProps = ChipToggleProps | ChipFactProps | ChipTagProps;

export type ChipGroupProps = {
  /**
   * Names the set. Given, the row becomes a `role="group"`; omitted, it stays a
   * plain `<div>` rather than an unnamed group (§8.24.4).
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`, so a consumer
   * whose name is conditional can pass it straight through instead of branching
   * on the whole element. An explicit `undefined` means the same as omitting it.
   */
  ariaLabel?: string | undefined;
  children?: Snippet;
  class?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'class'>;
