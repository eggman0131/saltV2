<!-- spec: ui-spec-v04.md §3.4 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { COMBOBOX_CONTEXT } from '../../headless/Combobox.headless.svelte';
  import type { ComboboxFieldProps } from './Combobox.types';

  let { class: className, children }: ComboboxFieldProps = $props();

  const ctx = COMBOBOX_CONTEXT.get();

  let fieldEl: HTMLDivElement | undefined = $state(undefined);

  $effect(() => {
    if (!fieldEl) return;
    ctx.setFieldAnchorEl(fieldEl);
    return () => ctx.setFieldAnchorEl(null);
  });
</script>

<div
  bind:this={fieldEl}
  class={cn(
    'salt-focus-ring-within flex items-stretch rounded [&>input]:flex-1 [&>input:not(:last-child)]:rounded-r-none [&>input:not(:last-child)]:border-r-0',
    className,
  )}
>
  {@render children?.()}
</div>
