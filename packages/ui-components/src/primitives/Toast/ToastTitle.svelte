<!-- spec: SPEC.md §6 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { ToastPartProps } from './Toast.types';

  let { class: className, children }: ToastPartProps = $props();
</script>

<div class={cn('text-sm font-semibold', className)}>
  {@render children?.()}
</div>
