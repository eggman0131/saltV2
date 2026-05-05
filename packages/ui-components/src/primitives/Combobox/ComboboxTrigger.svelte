<!-- spec: ui-spec-v04.md §2 v0.4 -->
<script lang="ts">
  import { ChevronDown } from 'lucide-svelte';
  import { cn } from '../../lib/cn';
  import { COMBOBOX_CONTEXT } from '../../headless/Combobox.headless.svelte';
  import { comboboxTriggerVariants } from './Combobox.variants';
  import type { ComboboxTriggerProps } from './Combobox.types';

  let { class: className, children }: ComboboxTriggerProps = $props();

  const ctx = COMBOBOX_CONTEXT.get();

  function handleClick() {
    ctx.togglePopup();
  }
</script>

<button
  type="button"
  tabindex="-1"
  aria-label="Toggle options"
  aria-controls={ctx.listboxId}
  aria-expanded={ctx.open}
  class={cn(comboboxTriggerVariants(), className)}
  onclick={handleClick}
>
  {#if children}
    {@render children()}
  {:else}
    <ChevronDown class="size-4" aria-hidden="true" />
  {/if}
</button>
