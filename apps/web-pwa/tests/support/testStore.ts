/**
 * The readable-store stand-in every page test mocks its services with (issue #922).
 *
 * ─── Why this file exists ────────────────────────────────────────────────────
 * Sixty test files each declared their own seventeen-line `makeStore` — ~1,020
 * duplicated lines, in four variants that differ only in whether the setter is
 * called `set` or `_set` and what the `forEach` parameter is named. Not one of
 * those differences was a decision. #941 measured the cost: 30.6% of the suite is
 * preamble before the first `it(`, and preamble is what makes a refactor's noise
 * indistinguishable from its breakage.
 *
 * ─── Why it lives here and not in `@salt/testing-utils` ──────────────────────
 * The layer map does not permit `web-pwa → testing-utils`, so routing this
 * through a package would need an issue-first layer-map edit — and
 * `@salt/testing-utils` is slated for deletion under #923 anyway. #941's Track C
 * puts the shared kit in `apps/web-pwa/tests/support/`, deliberately local.
 *
 * ─── How to use it from a `vi.hoisted` block ─────────────────────────────────
 * `vi.hoisted` runs BEFORE the file's imports, so a top-level `import` of this
 * module is not available inside one. Use the async form, which is the pattern
 * vitest documents for exactly this:
 *
 * ```ts
 * const { mockRecipes } = await vi.hoisted(async () => {
 *   const { makeStore } = await import('./support/testStore.js');
 *   return { mockRecipes: makeStore<readonly Recipe[]>([]) };
 * });
 * ```
 *
 * The stores must be created in the hoisted block rather than at module scope,
 * because a `vi.mock` factory runs during the import phase — before a top-level
 * `const` has initialised — and would hit the temporal dead zone.
 */

/** A test store: a Svelte-readable `subscribe`, plus a way to push a new value. */
export interface TestStore<T> {
  /** Calls back immediately with the current value, as a Svelte store does. */
  subscribe(fn: (v: T) => void): () => void;
  /** Push a new value to every subscriber. */
  set(v: T): void;
  /**
   * Alias of `set`. The name 52 of the 60 call sites used, kept so the shared
   * helper is a drop-in — an underscore prefix marking "this is the test's handle,
   * not part of the store contract the component sees".
   */
  _set(v: T): void;
  /** The current value, without subscribing. Two suites read it back. */
  _get(): T;
}

export function makeStore<T>(initial: T): TestStore<T> {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  const set = (v: T) => {
    value = v;
    subs.forEach((fn) => fn(v));
  };
  return {
    subscribe(fn: (v: T) => void) {
      subs.add(fn);
      fn(value);
      return () => {
        subs.delete(fn);
      };
    },
    set,
    _set: set,
    _get: () => value,
  };
}
