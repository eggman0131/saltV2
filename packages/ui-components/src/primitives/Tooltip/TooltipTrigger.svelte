<!-- spec: SPEC.md §8.8 v0.2.3 -->
<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Snippet } from 'svelte';

  let { children }: { children?: Snippet } = $props();
</script>

<Tooltip.Trigger>
  {@render children?.()}
</Tooltip.Trigger>
