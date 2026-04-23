<!-- spec: SPEC.md §5 v0.3 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';

  let { children }: { children?: Snippet } = $props();
</script>

<Dialog.Trigger>
  {@render children?.()}
</Dialog.Trigger>
