<!-- spec: ui-spec-v04.md §5.1 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { COMBOBOX_CONTEXT } from '../../headless/Combobox.headless.svelte';
  import { comboboxInputVariants } from './Combobox.variants';
  import type { ComboboxInputProps } from './Combobox.types';

  let { class: className, ...rest }: ComboboxInputProps = $props();

  const ctx = COMBOBOX_CONTEXT.get();

  let inputEl: HTMLInputElement | undefined = $state(undefined);

  // The input is the fallback anchor; Combobox prefers a ComboboxField's box when
  // one is present. Nothing here reads the anchor, so this cannot re-enter.
  $effect(() => {
    if (!inputEl) return;
    ctx.setInputAnchorEl(inputEl);
    return () => ctx.setInputAnchorEl(null);
  });

  function handleInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    ctx.setInputValue(val);
    ctx.openWhenTyping();
  }

  function handleClick() {
    if (ctx.openOnClick) ctx.openPopup();
  }

  function handleKeydown(e: KeyboardEvent) {
    ctx.handleInputKeydown(e);
  }

  function handleBlur() {
    ctx.handleInputBlur();
  }
</script>

<input
  bind:this={inputEl}
  {...rest}
  id={ctx.inputId}
  role="combobox"
  type="text"
  aria-expanded={ctx.open}
  aria-controls={ctx.open ? ctx.listboxId : undefined}
  aria-autocomplete="list"
  aria-activedescendant={ctx.getActiveDescendantId()}
  value={ctx.inputValue}
  placeholder={ctx.placeholder}
  autocomplete="off"
  class={cn(comboboxInputVariants(), className)}
  onclick={handleClick}
  oninput={handleInput}
  onkeydown={handleKeydown}
  onblur={handleBlur}
/>
