import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';

const { mockDefaultListId } = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) {
        subs.add(fn);
        fn(value);
        return () => {
          subs.delete(fn);
        };
      },
      _set(v: T) {
        value = v;
        subs.forEach((fn) => fn(v));
      },
    };
  }
  return { mockDefaultListId: makeStore<string | null | undefined>(undefined) };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({
  defaultListId: mockDefaultListId,
}));

import ShoppingListRedirectPage from '../src/routes/shopping/ShoppingListRedirectPage.svelte';
import { push } from 'svelte-spa-router';

/** Move the address bar without going through the (mocked-out) router. */
function setHash(hash: string): void {
  window.location.hash = hash;
}

describe('ShoppingListRedirectPage', () => {
  beforeEach(() => {
    vi.mocked(push).mockClear();
    mockDefaultListId._set(undefined);
    setHash('#/');
  });

  afterEach(() => {
    cleanup();
    setHash('');
  });

  it('waits for the config snapshot before redirecting', async () => {
    render(ShoppingListRedirectPage);
    await waitFor(() => expect(push).not.toHaveBeenCalled());
  });

  it('redirects to the default list once the config loads', async () => {
    render(ShoppingListRedirectPage);
    mockDefaultListId._set('list-1');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/shopping/list-1'));
  });

  it('redirects to list creation when there is no default list', async () => {
    render(ShoppingListRedirectPage);
    mockDefaultListId._set(null);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/shopping/new'));
  });

  it('also redirects when mounted at /shopping', async () => {
    setHash('#/shopping');
    render(ShoppingListRedirectPage);
    mockDefaultListId._set(null);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/shopping/new'));
  });

  // Regression: the config snapshot is async and can land after a navigation to
  // an unrelated route has been requested but before svelte-spa-router has
  // handled the resulting `hashchange` — this page is still mounted at that
  // moment. Redirecting then clobbers the requested route (the router reads the
  // live hash when it processes the event, so the requested route is never even
  // resolved), which is what made the /admin/… e2e specs flake.
  it('does not redirect once the URL has already moved to another route', async () => {
    render(ShoppingListRedirectPage);
    setHash('#/admin/canon/abc-123');
    mockDefaultListId._set(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(push).not.toHaveBeenCalled();
  });

  it('ignores a querystring on the current route when deciding', async () => {
    setHash('#/?foo=bar');
    render(ShoppingListRedirectPage);
    mockDefaultListId._set(null);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/shopping/new'));
  });
});
