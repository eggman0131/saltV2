<!-- spec: SPEC.md §8.1 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { createButtonState } from '../../headless/Button.headless.svelte';
  import { buttonVariants } from './Button.variants';
  import Spinner from '../Spinner/Spinner.svelte';
  import type { ButtonProps } from './Button.types';

  let {
    variant = 'solid',
    size = 'md',
    type = 'button',
    disabled = false,
    loading = false,
    fullWidth = false,
    ariaLabel,
    class: className,
    leading,
    trailing,
    children,
    onclick,
    ...rest
  }: ButtonProps = $props();

  const state = createButtonState({
    disabled: () => disabled ?? false,
    loading: () => loading,
  });

  $effect(() => {
    if (size === 'icon' && !ariaLabel) {
      console.warn(
        '[Button] size="icon" requires an ariaLabel prop for accessibility. See SPEC.md §8.1.',
      );
    }
  });

  function handleClick(e: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    if (!state.interactive) {
      e.preventDefault();
      return;
    }
    onclick?.(e);
  }
</script>

<button
  {type}
  class={cn(buttonVariants({ variant, size, fullWidth }), className)}
  disabled={state.disabled}
  data-disabled={state.disabled ? '' : undefined}
  data-loading={state.loading ? '' : undefined}
  aria-disabled={state.disabled || state.loading ? 'true' : undefined}
  aria-busy={state.loading ? 'true' : undefined}
  aria-label={ariaLabel}
  onclick={handleClick}
  {...rest}
>
  {#if state.loading}
    <Spinner size={16} />
  {:else if leading}
    {@render leading()}
  {/if}

  {@render children?.()}

  {#if !state.loading && trailing}
    {@render trailing()}
  {/if}
</button>
