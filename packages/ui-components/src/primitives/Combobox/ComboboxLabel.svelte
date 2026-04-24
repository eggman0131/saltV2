<!-- spec: ui-spec-v04.md §2 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { ComboboxLabelProps } from './Combobox.types';

  let { class: className, children }: ComboboxLabelProps = $props();
</script>

<div class={cn('px-2 py-1 text-xs font-semibold text-muted-foreground', className)}>
  {@render children?.()}
</div>
