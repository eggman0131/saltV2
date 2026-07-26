/**
 * The route path the ADDRESS BAR is on right now, parsed exactly the way
 * svelte-spa-router's own internal `getLocation()` parses it (hash after `#/`,
 * querystring stripped; no hash at all ⇒ `/`).
 *
 * Why not `svelte-spa-router`'s `location` / `router.loc` store: that store is
 * only updated when the router HANDLES a `hashchange`, which is a separate task
 * from the one that changed the URL. So there is a real window in which the URL
 * is already `#/admin/canon/x` while the store still reports `/`. Code that
 * decides "am I still the active route?" before performing a deferred
 * navigation must consult the URL, not the store, or it will act on a stale
 * answer and clobber a navigation that has already been requested.
 */
export function currentRoutePath(): string {
  if (typeof window === 'undefined') return '/';
  const href = window.location.href;
  const hashPosition = href.indexOf('#/');
  const location = hashPosition > -1 ? href.slice(hashPosition + 1) : '/';
  const qsPosition = location.indexOf('?');
  return qsPosition > -1 ? location.slice(0, qsPosition) : location;
}
