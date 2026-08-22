// spec: ui-spec-v10.md §8.28, §8.29 v0.10
export { default as Tabs } from './Tabs.svelte';
export { default as TabsList } from './TabsList.svelte';
export { default as TabsTrigger } from './TabsTrigger.svelte';
export { default as TabsContent } from './TabsContent.svelte';
export type { TabsProps, TabsListProps, TabsTriggerProps, TabsContentProps } from './Tabs.types';
export {
  tabsVariants,
  tabsListVariants,
  tabsTriggerVariants,
  tabsCountVariants,
  tabsContentVariants,
} from './Tabs.variants';
