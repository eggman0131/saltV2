// spec: ui-spec-v04.md §13.3, §16.3, §17.2 v0.4; ui-spec-v05.md §2.3 v0.5 (chrome); ui-spec-v15.md §1 v0.15 (navCollapsed)
import type { Snippet } from 'svelte';
import type { NavItem } from '../NavItem.types';

export interface AppShellProps {
  navItems: NavItem[];
  /**
   * Secondary destinations. The desktop SideNav has room, so it lists them inline
   * after `navItems`; the mobile BottomNav folds them behind its "More" tab.
   */
  overflowNavItems?: NavItem[];
  currentPath: string;
  title?: string;
  actions?: Snippet;
  /** Centred non-prod environment label for the TopBar; omit in production. */
  envLabel?: string | undefined;
  /** Tailwind classes overriding the TopBar surface for a non-prod environment. */
  envClass?: string | undefined;
  sideNavFooter?: Snippet;
  /**
   * Whether to render the shell's navigation chrome (`TopBar`, `SideNav`,
   * `BottomNav`). Defaults to `true`.
   *
   * Set `false` for a FULL-VIEWPORT route — a genuinely modal, single-task mode
   * that owns the whole screen (see ui-spec-v05 §2). The chrome is not rendered
   * at all rather than merely covered: a page painting over it leaves `TopBar`
   * and `BottomNav` in the DOM, in the tab order, and in the accessibility tree,
   * so keyboard focus lands on invisible navigation behind the overlay and
   * activating it navigates away mid-task (issue #641). `<main>` also drops its
   * BottomNav height reservation, since there is no BottomNav to clear.
   */
  chrome?: boolean;
  /**
   * Whether the desktop `SideNav` is collapsed. Bindable, defaults to `false`
   * (open). See ui-spec-v15 §1.
   *
   * Collapsed means the `SideNav` is NOT RENDERED — the same mechanism, and the
   * same reasoning, as `chrome` above: a nav that is merely hidden, `inert` or
   * painted over stays in the DOM, in the tab order and in the accessibility
   * tree (issue #641). `<main>` is a `flex-1` sibling in the same flex row, so
   * the freed 256px goes to the page automatically and no page is told anything.
   *
   * The state is IN-MEMORY and owned here. `AppShell` is mounted once for the
   * app's life, so the choice survives navigation — including in and out of a
   * full-viewport route — and a reload reopens the nav. Persisting it was
   * rejected on cost, not on principle: browser storage is forbidden (CLAUDE.md
   * Rule 3) and a member-document field is a schema plus a rules change for a
   * preference that costs one click to restate. `$bindable` is the seam to hang
   * that on if it is ever revisited, with no redesign here.
   *
   * `chrome={false}` dominates: a full-viewport route renders no nav either way,
   * and no control to toggle one.
   */
  navCollapsed?: boolean;
  class?: string;
  children?: Snippet;
}
