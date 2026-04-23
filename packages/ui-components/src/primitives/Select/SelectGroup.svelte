<!-- spec: SPEC.md §3 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { SelectGroupProps } from './Select.types';

  let { class: className, children }: SelectGroupProps = $props();
</script>

<div role="group" class={cn('py-1', className)}>
  {@render children?.()}
</div>
