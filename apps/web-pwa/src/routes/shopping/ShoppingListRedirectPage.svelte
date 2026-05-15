<script lang="ts">
  import { push } from 'svelte-spa-router';
  import { Spinner } from '@salt/ui-components';
  import { defaultListId } from '../../lib/shoppingListService.svelte.js';

  $effect(() => {
    const def = $defaultListId;
    if (def === undefined) return; // config not yet loaded
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
