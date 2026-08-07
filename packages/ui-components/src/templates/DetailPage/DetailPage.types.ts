// spec: SPEC.md §9.3 v0.2.3; ui-spec-v07.md §1 v0.7 (fill)
import type { Snippet } from 'svelte';

export type DetailPageProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  actions?: Snippet;
  metadata?: Snippet;
  children?: Snippet;
  class?: string;
  titleSlot?: Snippet;
  /**
   * Fill the app shell's content area instead of growing with the content, and give
   * `children` the leftover height (ui-spec-v07 §1). For a detail page whose body owns
   * its own scrolling — notably one laying two panes side by side that must scroll
   * independently of each other.
   *
   * `AppShell`'s `<main>` is `overflow-y-auto`, so it scrolls only ON OVERFLOW: a page
   * that exactly fits stops it scrolling without `AppShell` knowing anything about this.
   * That is the whole mechanism — do not set `overflow` on `<main>` and do not compute a
   * pixel height in the page (`calc(100dvh - …)`, measuring `TopBar`, reading
   * `clientHeight`).
   *
   * The consuming page **must** give its scrolling child `min-h-0 flex-1`; without it the
   * child is floored at its intrinsic height and the fill does nothing.
   *
   * This is not a way to make a page "fit on one screen". An ordinary detail page that is
   * simply tall should keep the default and let `<main>` scroll it.
   *
   * **Must not be combined with `metadata`** — that aside is `lg:sticky lg:top-4`, which
   * presupposes the ancestor scroller `fill` removes. Declared, not enforced.
   *
   * Default `false`, so every existing detail page is unaffected.
   */
  fill?: boolean;
};
