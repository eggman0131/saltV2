<!-- spec: SPEC.md §8.8 v0.2.6 -->
<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Snippet } from 'svelte';

  // Forward `class` and native attributes (aria-*, data-*, etc.) to the underlying
  // bits-ui trigger, which renders a focusable <button> by default — so callers can
  // style the hover/focus/tap target. Children-only usage stays backward-compatible.
  let {
    children,
    class: className,
    ...rest
  }: { children?: Snippet; class?: string; [key: string]: unknown } = $props();
</script>

<Tooltip.Trigger class={className} {...rest}>
  {@render children?.()}
</Tooltip.Trigger>
