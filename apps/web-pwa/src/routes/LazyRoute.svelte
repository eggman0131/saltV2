<script lang="ts">
  import type { Component } from 'svelte';
  import type { AsyncSvelteComponent } from 'svelte-spa-router/wrap';
  import RouteLoading from './RouteLoading.svelte';

  // The host that owns lazy route loading, in place of svelte-spa-router's own
  // `wrap({ asyncComponent, loadingComponent })` path (issue #599).
  //
  // WHY WE DO THE IMPORT OURSELVES. `Router.svelte`'s location effect assigns its
  // module-scoped `componentObj = obj` BEFORE awaiting a lazy route — but only on
  // the branch that renders a `loadingComponent`. A second location change landing
  // while that import is in flight cancels the first run; the re-run then sees
  // `componentObj == obj`, skips the whole load-and-swap block, and leaves the
  // loading placeholder on screen PERMANENTLY: correct URL, chunk fetched, no
  // error, no `vite:preloadError`, nothing pending, no retry short of a manual
  // reload. That is not exotic — an effect-driven redirect, a fast double tap on a
  // nav item, or a `push` racing the back button all produce it.
  //
  // Registering as a plain `wrap({ component })` takes the OTHER branch, which sets
  // `componentObj = null` before its await, so a re-run always re-enters and
  // re-swaps. The chunk fetch and the placeholder then live here, where a second
  // navigation is just a prop change we re-run deliberately. The upstream defect is
  // untouched; we no longer stand on it.
  //
  // `load` arrives already wrapped in `loadRouteWithFallback` (lazyRoute.ts), so
  // #472's failed-recovery fallback still applies — RouteLoadFailed simply resolves
  // as the module's default. The wrapping is done by the CALLER rather than here so
  // this component does not import `lazyRoute.ts`, which imports it (Rule 8).

  interface Props {
    load: AsyncSvelteComponent;
    // Everything svelte-spa-router puts on a route component: `params` (absent on
    // routes with no parameters), `onRouteEvent`, and any static `props`. Forwarded
    // verbatim so a lazy page sees exactly what an eagerly-imported one sees.
    [key: string]: unknown;
  }
  let { load, ...routeProps }: Props = $props();

  let loaded = $state.raw<Component<any, any> | null>(null);

  $effect(() => {
    const thunk = load;
    let cancelled = false;
    // Back to the placeholder whenever the route changes: this component instance
    // is reused across every lazy route (same constructor), so without the reset a
    // navigation would keep the OUTGOING page on screen until the new chunk lands.
    loaded = null;
    void Promise.resolve(thunk())
      .then((mod) => {
        // A thunk may resolve either a module namespace (`import()`) or a bare
        // component — the same two shapes the router itself unwraps.
        if (!cancelled)
          loaded = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
      })
      .catch(() => {
        // Only reachable on a FIRST chunk failure, where `loadRouteWithFallback`
        // rethrows on purpose so pwa.ts's `vite:preloadError` listener performs its
        // one silent reload (#472 Phase 1) — the page is on its way out, so there
        // is nothing to render and nothing to report here. A failure that survives
        // that reload resolves to RouteLoadFailed instead of rejecting.
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if loaded}
  {@const Loaded = loaded}
  <Loaded {...routeProps} />
{:else}
  <RouteLoading />
{/if}
