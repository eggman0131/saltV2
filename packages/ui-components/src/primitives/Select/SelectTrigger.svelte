<!-- spec: ui-spec-v03.md §3.4 v0.3.4 -->
<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import { cn } from '../../lib/cn';
  import { SELECT_CONTEXT } from '../../headless/Select.headless.svelte';
  import { selectTriggerVariants } from './Select.variants';
  import type { SelectTriggerProps } from './Select.types';

  let { class: className, children, ...restProps }: SelectTriggerProps = $props();

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
  {...restProps}
>
  {#if children}
    {@render children()}
  {:else}
    <!-- The one input in the app the ::placeholder base rule cannot reach: this
         is real text in a <span>, not a pseudo-element. It therefore carries the
         same treatment by hand so an unset Select reads like every other empty
         field (ui-spec-v03 §3.4, issue #821). -->
    <span class={ctx.value ? 'text-foreground' : 'text-placeholder italic'}>
      {ctx.displayLabel ?? ctx.placeholder ?? 'Select…'}
    </span>
    <ChevronDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  {/if}
</button>
