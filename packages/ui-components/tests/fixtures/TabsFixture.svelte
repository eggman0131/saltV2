<script lang="ts">
  import Tabs from '../../src/primitives/Tabs/Tabs.svelte';
  import TabsList from '../../src/primitives/Tabs/TabsList.svelte';
  import TabsTrigger from '../../src/primitives/Tabs/TabsTrigger.svelte';
  import TabsContent from '../../src/primitives/Tabs/TabsContent.svelte';

  let {
    value = $bindable(),
    defaultValue = 'ingredients',
    onValueChange,
    ariaLabel = 'Recipe',
    counts = true,
  }: {
    value?: string;
    defaultValue?: string;
    onValueChange?: (v: string) => void;
    ariaLabel?: string | undefined;
    counts?: boolean;
  } = $props();
</script>

<Tabs bind:value {defaultValue} {onValueChange} data-testid="tabs">
  <TabsList {ariaLabel} data-testid="list">
    <TabsTrigger value="ingredients" count={counts ? 19 : undefined} data-testid="tab-ingredients">
      Ingredients
    </TabsTrigger>
    <TabsTrigger value="method" count={counts ? 14 : undefined} data-testid="tab-method">
      Method
    </TabsTrigger>
    <TabsTrigger value="notes" count={counts ? 0 : undefined} data-testid="tab-notes">
      Notes
    </TabsTrigger>
  </TabsList>
  <TabsContent value="ingredients" data-testid="panel-ingredients">Two onions</TabsContent>
  <TabsContent value="method" data-testid="panel-method">Chop them</TabsContent>
  <TabsContent value="notes" data-testid="panel-notes">Nothing yet</TabsContent>
</Tabs>
