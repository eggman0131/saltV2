import { describe, expect, it, vi } from 'vitest';

// The nav lists themselves (src/lib/nav.ts). `goBack` has its own suite; this one
// guards the shape of the tabs, which is a design constraint rather than logic:
// FOUR primary destinations, and a single word on each of them.

vi.mock('svelte-spa-router', () => ({ push: vi.fn(), pop: vi.fn() }));

const { navItems, overflowNavItems } = await import('../src/lib/nav.js');

describe('navItems', () => {
  it('is four primary destinations, no more', () => {
    // BottomNav splits a fixed bar into five equal columns — these four plus
    // "More" — so a fifth tab is a spec change, not an addition (ui-spec-v04 §17.1).
    expect(navItems.map((i) => i.id)).toEqual(['shopping', 'mealplan', 'recipes', 'mine']);
  });

  it('labels the personal view "Kitchen", leaving its id and route alone', () => {
    // Renamed from "Mine" in #755. Everything keys off `id`/`href`; only the word
    // on the tab moved, so the route, the badge and the tests all still find it.
    expect(navItems[3]).toMatchObject({ id: 'mine', label: 'Kitchen', href: '#/mine' });
  });

  it('keeps every tab label to one word — BottomNav never truncates', () => {
    for (const item of [...navItems, ...overflowNavItems]) {
      expect(item.label).not.toContain(' ');
    }
  });

  it('leaves Chef in the overflow — a link from elsewhere is not a promotion', () => {
    expect(navItems.map((i) => i.id)).not.toContain('chat');
    expect(overflowNavItems.map((i) => i.id)).toContain('chat');
  });

  it('puts the in-flight surface in the overflow, not in the primary four', () => {
    // Issue #812. A run is something you glance at once a morning, and the primary
    // four are full — a fifth tab is a spec change, not an addition. It is also
    // deliberately NOT folded into "Kitchen": batches are family-shared, and that
    // tab is a per-user projection.
    expect(overflowNavItems.find((i) => i.id === 'batches')).toMatchObject({
      label: 'Batches',
      href: '#/batches',
    });
    expect(navItems.map((i) => i.id)).not.toContain('batches');
  });
});
