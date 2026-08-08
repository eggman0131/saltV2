import { beforeEach, describe, expect, it, vi } from 'vitest';

// `goBack` (src/lib/nav.ts) must return the user to the previous in-app screen
// via the router's history-back, but fall back to the caller's route when the
// current screen is the FIRST in-app entry — otherwise a PWA cold-launch /
// deep-link straight onto a detail page would pop the user clean out of the app.
//
// nav.ts stamps each history entry with a monotonic `__saltIdx` on `hashchange`
// and reads the current entry's index at call time, so these tests drive
// `window.history.state` (and dispatch `hashchange`) to reproduce navigations.

const push = vi.fn();
const pop = vi.fn();
vi.mock('svelte-spa-router', () => ({ push, pop }));

// Imported once: nav.ts registers its hashchange listener and stamps the initial
// entry at module load. `goBack` reads `window.history.state` on each call.
const { goBack } = await import('../src/lib/nav.js');

describe('goBack', () => {
  beforeEach(() => {
    push.mockClear();
    pop.mockClear();
  });

  it('falls back to the given route on the first in-app entry (idx 0)', () => {
    window.history.replaceState({ __saltIdx: 0 }, '', '#/recipes/abc');

    goBack('/recipes');

    expect(push).toHaveBeenCalledWith('/recipes');
    expect(pop).not.toHaveBeenCalled();
  });

  it('falls back when the entry is unstamped (deep-link / null state)', () => {
    window.history.replaceState(null, '', '#/recipes/abc');

    goBack('/recipes');

    expect(push).toHaveBeenCalledWith('/recipes');
    expect(pop).not.toHaveBeenCalled();
  });

  it('pops browser history when there is an in-app screen behind the current entry', () => {
    window.history.replaceState({ __saltIdx: 2 }, '', '#/recipes/abc');

    goBack('/recipes');

    expect(pop).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('stamps a fresh, unstamped entry with a numeric index on navigation', () => {
    window.history.replaceState(null, '', '#/recipes/new-page');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    const state = window.history.state as { __saltIdx?: number } | null;
    expect(state?.__saltIdx).toBeTypeOf('number');
  });

  it('leaves an already-stamped entry untouched on navigation (back/forward)', () => {
    window.history.replaceState({ __saltIdx: 5 }, '', '#/recipes/abc');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    const state = window.history.state as { __saltIdx?: number } | null;
    expect(state?.__saltIdx).toBe(5);
  });
});
