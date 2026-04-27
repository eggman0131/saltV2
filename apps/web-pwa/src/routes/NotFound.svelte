<script lang="ts">
  import { EmptyState } from '@salt/ui-components';
  import { Button } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
</script>

<div class="p-4 sm:p-6">
  <EmptyState title="Page not found" description="The page you're looking for doesn't exist.">
    {#snippet actions()}
      <Button onclick={() => push('/')}>Go home</Button>
    {/snippet}
  </EmptyState>
</div>
