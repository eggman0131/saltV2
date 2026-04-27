<script lang="ts">
  import { Button, ListPage } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
</script>

<div class="p-4 sm:p-6">
  <ListPage title="Ingredients" description="Your canonical ingredient database." isEmpty>
    {#snippet actions()}
      <Button onclick={() => push('/canon/new')}>Add ingredient</Button>
    {/snippet}
  </ListPage>
</div>
