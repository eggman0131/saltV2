<!-- spec: ui-spec-v10.md §8.29 v0.10 -->
<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { tabsListVariants } from './Tabs.variants';
  import type { TabsListProps } from './Tabs.types';

  let { ariaLabel, class: className, children, ...rest }: TabsListProps = $props();
</script>

<TabsPrimitive.List class={cn(tabsListVariants(), className)} aria-label={ariaLabel} {...rest}>
  {@render children?.()}
</TabsPrimitive.List>
