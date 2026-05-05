<!-- spec: SPEC.md §3 v0.3 -->
<script lang="ts">
  import { ChevronDown } from 'lucide-svelte';
  import { cn } from '../../lib/cn';
  import { SELECT_CONTEXT } from '../../headless/Select.headless.svelte';
  import { selectTriggerVariants } from './Select.variants';
  import type { SelectTriggerProps } from './Select.types';

  let { class: className, children }: SelectTriggerProps = $props();

  const ctx = SELECT_CONTEXT.get();

  let el: HTMLButtonElement | undefined = $state(undefined);

  $effect(() => {
    if (!el) return;
    ctx.setTriggerEl(el);
    return () => ctx.setTriggerEl(undefined);
  });

  function handleClick() {
    ctx.toggle();
  }

  function handleKeydown(e: KeyboardEvent) {
    ctx.handleTriggerKeydown(e);
  }
</script>

<button
  bind:this={el}
  id={ctx.triggerId}
  type="button"
  aria-haspopup="listbox"
  aria-expanded={ctx.open}
  aria-controls={ctx.open ? ctx.listboxId : undefined}
  aria-disabled={ctx.disabled || undefined}
  disabled={ctx.disabled}
  class={cn(selectTriggerVariants({ disabled: ctx.disabled }), className)}
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  {#if children}
    {@render children()}
  {:else}
    <span class={ctx.value ? 'text-foreground' : 'text-muted-foreground'}>
      {ctx.displayLabel ?? ctx.placeholder ?? 'Select…'}
    </span>
    <ChevronDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  {/if}
</button>
