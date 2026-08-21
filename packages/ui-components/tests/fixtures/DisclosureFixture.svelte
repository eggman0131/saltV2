<script lang="ts">
  import DisclosureChevron from '../../src/primitives/Disclosure/DisclosureChevron.svelte';
  import DisclosureTrigger from '../../src/primitives/Disclosure/DisclosureTrigger.svelte';
  import type { DisclosureTriggerProps } from '../../src/primitives/Disclosure/Disclosure.types';

  let { chevronSize = 14, ...trigger }: { chevronSize?: number } & DisclosureTriggerProps =
    $props();
</script>

<DisclosureTrigger {...trigger} data-testid="trigger">
  Beef mince
  <DisclosureChevron expanded={trigger.expanded} size={chevronSize} />
</DisclosureTrigger>
