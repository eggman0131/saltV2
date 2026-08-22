<!-- spec: ui-spec-v10.md §8.28, §8.29 v0.10 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { tabsVariants } from './Tabs.variants';
  import type { TabsProps } from './Tabs.types';

  let {
    value = $bindable(),
    defaultValue = '',
    onValueChange,
    class: className,
    children,
    ...rest
  }: TabsProps = $props();

  // Same seeding as `Sheet` (v0.3 §5): an uncontrolled host passes nothing, and
  // `defaultValue` becomes the initial selection once, untracked so a later
  // change to it does not yank the panel out from under the reader.
  if (value === undefined) value = untrack(() => defaultValue);

  // `value` is written back BEFORE the callback runs, so a host reading it in
  // `onValueChange` sees the new tab rather than the one it just left.
  function handleValueChange(next: string): void {
    value = next;
    onValueChange?.(next);
  }
</script>

<TabsPrimitive.Root
  value={value ?? ''}
  onValueChange={handleValueChange}
  class={cn(tabsVariants(), className)}
  {...rest}
>
  {@render children?.()}
</TabsPrimitive.Root>
