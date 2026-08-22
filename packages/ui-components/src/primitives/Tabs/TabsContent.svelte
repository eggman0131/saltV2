<!-- spec: ui-spec-v10.md §8.29 v0.10 -->
<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { tabsContentVariants } from './Tabs.variants';
  import type { TabsContentProps } from './Tabs.types';

  let { value, class: className, children, ...rest }: TabsContentProps = $props();
</script>

<TabsPrimitive.Content {value} class={cn(tabsContentVariants(), className)} {...rest}>
  {@render children?.()}
</TabsPrimitive.Content>
