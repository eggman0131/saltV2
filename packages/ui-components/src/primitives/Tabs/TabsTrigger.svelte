<!-- spec: ui-spec-v10.md §8.29 v0.10 -->
<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { tabsTriggerVariants, tabsCountVariants } from './Tabs.variants';
  import type { TabsTriggerProps } from './Tabs.types';

  let { value, count, class: className, children, ...rest }: TabsTriggerProps = $props();
</script>

<TabsPrimitive.Trigger {value} class={cn(tabsTriggerVariants(), className)} {...rest}>
  {@render children?.()}
  <!-- Inside the button, so it joins the tab's accessible name — "Ingredients 19"
       is what the tab IS, not decoration hung beside it (§8.28.4). `0` is a real
       count and renders; only an omitted `count` renders nothing. -->
  {#if count !== undefined}
    <span class={tabsCountVariants()}>{count}</span>
  {/if}
</TabsPrimitive.Trigger>
