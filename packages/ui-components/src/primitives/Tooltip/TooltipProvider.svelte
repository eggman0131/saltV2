<!-- spec: SPEC.md §8.8 v0.2.3 -->
<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { TooltipProviderProps } from './Tooltip.types';

  let { children }: TooltipProviderProps = $props();
</script>

<Tooltip.Provider>
  {@render children?.()}
</Tooltip.Provider>
