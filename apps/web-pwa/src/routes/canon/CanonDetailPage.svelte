<script lang="ts">
  import { DetailPage, Text } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';

  let { params }: { params: Record<string, string> } = $props();
</script>

<div class="p-4 sm:p-6">
  <DetailPage
    title="Ingredient"
    subtitle={params.id}
    onBack={() => push('/canon')}
    backLabel="Ingredients"
  >
    <Text muted>Detail view coming soon.</Text>
  </DetailPage>
</div>
