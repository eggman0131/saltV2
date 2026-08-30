// spec: ui-spec-v05.md §3 v0.5
// Covers chrome suppression for full-viewport routes only. The rest of AppShell
// (h-dvh constraint, env banner, overflow nav) is spec'd in ui-spec-v04 §13/§16/§17.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { House, Settings } from '@lucide/svelte';
import AppShell from '../src/layout/AppShell/AppShell.svelte';
import type { NavItem } from '../src/layout/NavItem.types';

afterEach(() => cleanup());

const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: House, href: '/' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

/** Every focusable descendant, in tab order — what a keyboard user can reach. */
function focusables(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])')];
}

/**
 * The nav-height token both the nav and its reservation read (design.md
 * `layout`, salt.css `--salt-layout-*`). Named once here so a rename moves the
 * assertions with it rather than leaving them pinned to a stale string.
 */
const NAV_HEIGHT_VAR = '--salt-layout-bottom-nav-height';

describe('AppShell chrome suppression (ui-spec-v05 §3)', () => {
  it('renders the nav chrome by default', () => {
    const { container } = render(AppShell, { props: { navItems, currentPath: '/' } });
    expect(container.querySelector('header')).toBeTruthy();
    expect(container.querySelectorAll('nav').length).toBeGreaterThan(0);
    expect(focusables(container).length).toBeGreaterThan(0);
  });

  // Issue #641. A full-viewport page that merely PAINTS OVER the shell leaves
  // TopBar/SideNav/BottomNav in the DOM: still focusable, still in the
  // accessibility tree. A keyboard user tabbing through cook mode landed on
  // invisible navigation behind the overlay, and activating it left the cook.
  // Not rendering is what removes it from both the tab order and the a11y tree —
  // which is why this asserts absence from the DOM, not `inert` or `aria-hidden`.
  it('renders NO nav chrome — and nothing focusable — when chrome={false}', () => {
    const { container } = render(AppShell, {
      props: { navItems, currentPath: '/recipes/r1/cook', chrome: false },
    });
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('nav')).toBeNull();
    expect(focusables(container)).toHaveLength(0);
  });

  it('drops <main>’s BottomNav height reservation when there is no BottomNav', () => {
    // Asserted on the TOKEN, not on `3.5rem`. These two assertions used to name
    // the literal, and that they had to change when #930 introduced the token is
    // itself the finding: the number was load-bearing in two places at once —
    // the nav that sets the height, and the test that pinned the reservation.
    const reservation = `pb-[calc(var(${NAV_HEIGHT_VAR})`;
    const withChrome = render(AppShell, { props: { navItems, currentPath: '/' } });
    expect(withChrome.container.querySelector('main')!.className).toContain(reservation);
    cleanup();

    const bare = render(AppShell, {
      props: { navItems, currentPath: '/recipes/r1/cook', chrome: false },
    });
    expect(bare.container.querySelector('main')!.className).not.toContain(reservation);
  });

  it('reserves exactly the height the nav renders at — one token, read twice', () => {
    // The whole point of the token. If the reservation and the nav ever read
    // different vars, content hides under the nav and nothing else says so.
    const { container } = render(AppShell, { props: { navItems, currentPath: '/' } });
    const main = container.querySelector('main')!.className;
    // Scoped to the BottomNav specifically. SideNav renders a `nav > ul` too and
    // carries the SAME `aria-label="Main navigation"`, so neither the element
    // nor the label distinguishes them — the fixed bottom edge does, and it is
    // the whole reason this nav has a height worth reserving.
    const navRow = container.querySelector('nav.fixed.bottom-0 ul')!.className;
    expect(main).toContain(NAV_HEIGHT_VAR);
    expect(navRow).toContain(NAV_HEIGHT_VAR);
  });
});
