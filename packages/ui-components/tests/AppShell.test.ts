// spec: ui-spec-v05.md §2 v0.5; ui-spec-v15.md §1 v0.15 (navCollapsed)
// Covers chrome suppression for full-viewport routes and the collapsible
// SideNav. The rest of AppShell (h-dvh constraint, env banner, overflow nav) is
// spec'd in ui-spec-v04 §13/§16/§17.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { House, Settings } from '@lucide/svelte';
import AppShell from '../src/layout/AppShell/AppShell.svelte';
import { SIDE_NAV_ID } from '../src/layout/SideNav/SideNav.types';
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

describe('AppShell chrome suppression (ui-spec-v05 §2)', () => {
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

describe('AppShell collapsible SideNav (ui-spec-v15 §1)', () => {
  /** The TopBar's collapse control. `aria-expanded` is what makes it that one. */
  const toggle = (c: HTMLElement) =>
    c.querySelector<HTMLButtonElement>('header button[aria-expanded]');

  it('renders the SideNav and its toggle by default', () => {
    const { container } = render(AppShell, { props: { navItems, currentPath: '/' } });
    expect(container.querySelector(`#${SIDE_NAV_ID}`)).toBeTruthy();

    const control = toggle(container)!;
    expect(control).toBeTruthy();
    expect(control.getAttribute('aria-expanded')).toBe('true');
    // The name says what pressing it DOES, not what it is (ui-spec-v15 §1.4).
    expect(control.getAttribute('aria-label')).toBe('Hide navigation');
    // …and `aria-controls` names an element that is actually here while expanded.
    expect(container.querySelector(`#${control.getAttribute('aria-controls')}`)).toBe(
      container.querySelector(`#${SIDE_NAV_ID}`),
    );
  });

  // Issue #641 one gate along. A collapsed nav that is merely `hidden`, `w-0`,
  // `inert` or painted over stays in the DOM, in the tab order and in the
  // accessibility tree — so a keyboard user tabs into navigation that is not on
  // screen. Not rendering is what removes it from both, which is why this
  // asserts absence from the DOM AND the drop in what a keyboard can reach:
  // the first assertion alone would pass over an `aria-hidden` nav that kept a
  // different id, and the count alone would pass over a nav rendered empty.
  it('renders NO SideNav — and none of its links — when navCollapsed', () => {
    const open = render(AppShell, { props: { navItems, currentPath: '/' } });
    const sideNav = open.container.querySelector<HTMLElement>(`#${SIDE_NAV_ID}`)!;
    const sideNavReachable = focusables(sideNav).length;
    expect(sideNavReachable).toBeGreaterThan(0);
    const openReachable = focusables(open.container).length;
    cleanup();

    const { container } = render(AppShell, {
      props: { navItems, currentPath: '/', navCollapsed: true },
    });
    expect(container.querySelector(`#${SIDE_NAV_ID}`)).toBeNull();
    // SideNav and BottomNav carry the SAME `aria-label`, so the label cannot
    // tell them apart — one nav survives, and its fixed bottom edge says which.
    expect(container.querySelectorAll('nav[aria-label="Main navigation"]')).toHaveLength(1);
    expect(container.querySelector('nav.fixed.bottom-0')).toBeTruthy();
    expect(focusables(container)).toHaveLength(openReachable - sideNavReachable);
  });

  it('tracks the state on aria-expanded, and the control says which way it goes', () => {
    const { container } = render(AppShell, {
      props: { navItems, currentPath: '/', navCollapsed: true },
    });
    const control = toggle(container)!;
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(control.getAttribute('aria-label')).toBe('Show navigation');
  });

  it('toggles with no binding at the call site — the uncontrolled path the app uses', async () => {
    const { container } = render(AppShell, { props: { navItems, currentPath: '/' } });
    expect(container.querySelector(`#${SIDE_NAV_ID}`)).toBeTruthy();

    await fireEvent.click(toggle(container)!);
    expect(container.querySelector(`#${SIDE_NAV_ID}`)).toBeNull();
    expect(toggle(container)!.getAttribute('aria-expanded')).toBe('false');

    await fireEvent.click(toggle(container)!);
    expect(container.querySelector(`#${SIDE_NAV_ID}`)).toBeTruthy();
    expect(toggle(container)!.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders no control when there is no chrome to toggle', () => {
    const { container } = render(AppShell, {
      props: { navItems, currentPath: '/recipes/r1/cook', chrome: false, navCollapsed: true },
    });
    expect(container.querySelector('header')).toBeNull();
    expect(toggle(container)).toBeNull();
    expect(focusables(container)).toHaveLength(0);
  });
});
