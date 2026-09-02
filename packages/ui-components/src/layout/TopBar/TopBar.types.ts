// spec: ui-spec-v04.md §16.2 v0.4; ui-spec-v15.md §1.4 v0.15 (nav toggle)
import type { Snippet } from 'svelte';

export interface TopBarProps {
  title?: string;
  actions?: Snippet | undefined;
  /**
   * Centred environment label (e.g. "Staging"), rendered dead-centre on the bar
   * independent of the title and actions. Omit in production to show no label.
   */
  envLabel?: string | undefined;
  /**
   * Tailwind classes overriding the bar surface (background / text / border
   * colour) for a non-prod environment. Omit to keep the default `bg-card`
   * surface. The colour vocabulary is the app's concern, so it is passed in
   * rather than mapped here — TopBar stays environment-agnostic.
   */
  envClass?: string | undefined;
  /**
   * Whether the shell's `SideNav` is currently collapsed (ui-spec-v15 §1.4).
   * Drives the toggle's glyph, its accessible name and its `aria-expanded`;
   * ignored when `onToggleNav` is not supplied, since there is then no control.
   */
  navCollapsed?: boolean;
  /**
   * Collapses / restores the shell's `SideNav`. **Supplying it is what renders
   * the control** — a `TopBar` used outside `AppShell` has no `SideNav` to
   * collapse and shows no toggle. The state itself lives in `AppShell`
   * (ui-spec-v15 §1.3); `TopBar` only reports the press.
   */
  onToggleNav?: (() => void) | undefined;
  class?: string;
}
