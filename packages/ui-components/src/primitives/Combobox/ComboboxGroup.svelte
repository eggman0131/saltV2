<!-- spec: ui-spec-v04.md §2 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { ComboboxGroupProps } from './Combobox.types';

  let { class: className, children }: ComboboxGroupProps = $props();
</script>

<div role="group" class={cn('py-1', className)}>
  {@render children?.()}
</div>
