<script lang="ts">
  import { push } from 'svelte-spa-router';
  import { Spinner } from '@salt/ui-components';
  import { defaultListId } from '../../lib/shoppingListService.svelte.js';
  import { currentRoutePath } from '../../lib/currentRoutePath.js';

  // The two paths this page is mounted for (see routes/index.ts). Anything else
  // means a navigation away from here has already been requested.
  const REDIRECT_PATHS = ['/', '/shopping'];

  $effect(() => {
    const def = $defaultListId;
    if (def === undefined) return; // config not yet loaded
    // Only redirect while this page is still where the user is headed. The
    // config snapshot is asynchronous and can land AFTER a navigation to an
    // unrelated route has been requested but before svelte-spa-router has
    // processed it — this page is then still mounted, its effect still live,
    // and an unconditional `push` silently clobbers that navigation. (That race
    // is what made the /admin/… e2e specs flake: the router reads the live hash
    // when it handles `hashchange`, so a stray `push` in this window means the
    // requested route is never even resolved.) `currentRoutePath` reads the
    // address bar rather than the router's store, which lags by exactly this
    // window.
    if (!REDIRECT_PATHS.includes(currentRoutePath())) return;
    if (def) {
      push(`/shopping/${def}`);
    } else {
      push('/shopping/new');
    }
  });
</script>

<div class="flex items-center justify-center py-12 p-4 sm:p-6">
  <Spinner size={24} />
</div>
