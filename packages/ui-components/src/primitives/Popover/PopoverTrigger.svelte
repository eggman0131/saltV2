<!-- spec: SPEC.md §8.7 v0.2.3 -->
<script lang="ts">
  import { Popover } from 'bits-ui';
  import type { Snippet } from 'svelte';

  let { children }: { children?: Snippet } = $props();
</script>

<Popover.Trigger>
  {@render children?.()}
</Popover.Trigger>
