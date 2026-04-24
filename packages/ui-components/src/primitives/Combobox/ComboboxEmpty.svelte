<!-- spec: ui-spec-v04.md §5.4, §8.5 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { ComboboxEmptyProps } from './Combobox.types';

  let { class: className, children }: ComboboxEmptyProps = $props();
</script>

<div
  aria-hidden="true"
  tabindex="-1"
  class={cn('px-2 py-6 text-center text-sm text-muted-foreground', className)}
>
  {@render children?.()}
</div>
