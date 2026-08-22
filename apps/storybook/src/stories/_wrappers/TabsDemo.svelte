<script lang="ts">
  import { Button, Tabs, TabsContent, TabsList, TabsTrigger, Text } from '@salt/ui-components';

  let {
    ariaLabel = 'Recipe',
    counts = true,
  }: { ariaLabel?: string | undefined; counts?: boolean } = $props();

  const INGREDIENTS = ['2 onions', '400 g pearl barley', '1 l chicken stock', 'A knob of butter'];
  const METHOD = ['Sweat the onions.', 'Toast the barley.', 'Ladle the stock in slowly.'];

  // The tab strip is controlled from the page, which is the whole point of
  // §8.28.5 — the button below moves the selection without touching the strip.
  let tab = $state('ingredients');
</script>

<Tabs bind:value={tab}>
  <TabsList {ariaLabel}>
    <TabsTrigger value="ingredients" count={counts ? INGREDIENTS.length : undefined}>
      Ingredients
    </TabsTrigger>
    <TabsTrigger value="method" count={counts ? METHOD.length : undefined}>Method</TabsTrigger>
    <TabsTrigger value="notes" count={counts ? 0 : undefined}>Notes</TabsTrigger>
  </TabsList>

  <TabsContent value="ingredients">
    {#each INGREDIENTS as line (line)}
      <Text>{line}</Text>
    {/each}
  </TabsContent>
  <TabsContent value="method">
    {#each METHOD as line, i (line)}
      <Text>{i + 1}. {line}</Text>
    {/each}
  </TabsContent>
  <TabsContent value="notes">
    <Text muted>Nothing written down yet.</Text>
  </TabsContent>
</Tabs>

<div class="mt-6">
  <Button
    size="sm"
    variant="outline"
    onclick={() => (tab = tab === 'method' ? 'ingredients' : 'method')}
  >
    Jump to {tab === 'method' ? 'Ingredients' : 'Method'}
  </Button>
</div>
