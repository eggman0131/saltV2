<!-- spec: ui-spec-v09.md §8.25 v0.9 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import DisclosureChevron from '../Disclosure/DisclosureChevron.svelte';
  import DisclosureTrigger from '../Disclosure/DisclosureTrigger.svelte';
  import type { CollapsibleSectionProps } from './CollapsibleSection.types';

  let {
    title,
    expanded,
    onToggle,
    collapsedCount,
    action,
    triggerTestId,
    class: className,
    children,
    ...rest
  }: CollapsibleSectionProps = $props();
</script>

<section class={cn('salt-collapsible', className)} {...rest}>
  <div class="salt-collapsible__header">
    <DisclosureTrigger
      {expanded}
      class="salt-collapsible__trigger"
      onclick={onToggle}
      data-testid={triggerTestId}
    >
      <DisclosureChevron {expanded} size={14} />
      {title}
      {#if !expanded && collapsedCount !== undefined}
        <span class="salt-collapsible__count">({collapsedCount})</span>
      {/if}
    </DisclosureTrigger>
    {#if action}
      {@render action()}
    {/if}
  </div>

  <!-- Removed, not hidden (§8.25.3): a collapsed section holds no focusable
       descendants and contributes nothing to the accessibility tree. -->
  {#if expanded}
    {@render children?.()}
  {/if}
</section>
