<!-- spec: SPEC.md §3 v0.3 -->
<script lang="ts">
  import { tick } from 'svelte';
  import { cn } from '../../lib/cn';
  import { SELECT_CONTEXT } from '../../headless/Select.headless.svelte';
  import { selectContentVariants } from './Select.variants';
  import type { SelectContentProps } from './Select.types';

  let { class: className, children }: SelectContentProps = $props();

  const ctx = SELECT_CONTEXT.get();

  let listboxEl: HTMLElement | undefined = $state(undefined);
  let wrapperEl: HTMLDivElement | undefined = $state(undefined);

  // Portal: move wrapper to target after mount
  $effect(() => {
    const el = wrapperEl;
    if (!el || ctx.portal === false) return;

    const target =
      typeof ctx.portal === 'string'
        ? ((document.querySelector(ctx.portal) as HTMLElement | null) ?? document.body)
        : ctx.portal;

    target.appendChild(el);
    return () => el.remove();
  });

  // On open: initialize active option, then focus the listbox
  $effect(() => {
    if (!ctx.open || !listboxEl) return;
    // tick() lets child SelectItem $effects run first (registering items)
    tick().then(() => {
      ctx.initializeOpen();
      listboxEl?.focus();
    });
  });

  function handleKeydown(e: KeyboardEvent) {
    ctx.handleListboxKeydown(e);
  }
</script>

{#if ctx.open}
  <div bind:this={wrapperEl} class="relative z-50">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={listboxEl}
      id={ctx.listboxId}
      role="listbox"
      tabindex="-1"
      aria-labelledby={ctx.triggerId}
      aria-activedescendant={ctx.activeOptionId}
      class={cn(selectContentVariants(), className)}
      onkeydown={handleKeydown}
    >
      {@render children?.()}
    </div>
  </div>
{/if}
