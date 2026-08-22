// spec: ui-spec-v10.md §8.28, §8.29 v0.10
import type { Snippet } from 'svelte';

/**
 * The whole of a Tabs part's passthrough: `data-*`, and nothing else (§8.29.5).
 *
 * Every other attribute these four elements carry — `role`, `id`,
 * `aria-selected`, `aria-controls`, `tabindex`, `hidden` — is computed by
 * bits-ui and wiring them together IS the primitive. A wider passthrough would
 * hand a page the means to overwrite exactly the attributes it must not touch,
 * and (because bits' own prop types are `Without<>` intersections) would not
 * even typecheck. `data-testid` is the thing consumers actually need, so it is
 * the thing that rides.
 */
type DataAttributes = { [key: `data-${string}`]: unknown };

export type TabsProps = {
  /**
   * The selected tab's value. `$bindable`, so a page can both read which panel
   * is showing and move the selection itself — `bind:value`, or a plain `value`
   * plus `onValueChange`. §8.28.5 says why that is not optional.
   */
  value?: string;
  /** The tab selected on first render when `value` is not supplied. */
  defaultValue?: string;
  /** Called with the new value whenever the selection changes, for any reason. */
  onValueChange?: (value: string) => void;
  /** `TabsList` and the `TabsContent` panels, in that order. */
  children?: Snippet;
  class?: string;
} & DataAttributes;

export type TabsListProps = {
  /**
   * Names the strip. A `role="tablist"` is always rendered — unlike `ChipGroup`
   * (v0.9 §8.24.4) there is no unnamed fallback available — so a name is
   * strongly preferred and every consumer should pass one (§8.28.6).
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`, matching
   * `ChipGroupProps['ariaLabel']`.
   */
  ariaLabel?: string | undefined;
  /** The `TabsTrigger`s. */
  children?: Snippet;
  class?: string;
} & DataAttributes;

export type TabsTriggerProps = {
  /** Ties this tab to the `TabsContent` carrying the same `value`. */
  value: string;
  /**
   * A number rendered after the label — "Ingredients 19". Part of the tab's
   * accessible name, deliberately; §8.28.4 says why it is a prop rather than
   * something the caller interpolates into `children`.
   */
  count?: number | undefined;
  /** The tab's label. Text only. */
  children?: Snippet;
  class?: string;
} & DataAttributes;

export type TabsContentProps = {
  /** Ties this panel to the `TabsTrigger` carrying the same `value`. */
  value: string;
  /** The panel's content, owned entirely by the page (§8.28.3). */
  children?: Snippet;
  class?: string;
} & DataAttributes;
