<!-- spec: SPEC.md §8.6 v0.2.3 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';

  let { children }: { children?: Snippet } = $props();
</script>

<Dialog.Trigger>
  {@render children?.()}
</Dialog.Trigger>
