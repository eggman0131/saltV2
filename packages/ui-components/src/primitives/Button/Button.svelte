<!-- spec: ui-spec-v02.md §8.1 v0.2.7 -->
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
    // Pulled out of `...rest` on purpose: the press treatment listens on these,
    // and a spread lands AFTER them, so a consumer's handler would silently
    // replace ours. Taken as props and forwarded instead — both run.
    onpointerdown,
    onpointerup,
    onpointercancel,
    onpointerleave,
    onkeydown,
    onkeyup,
    onblur,
    ...rest
  }: ButtonProps = $props();

  const state = createButtonState({
    disabled: () => disabled ?? false,
    loading: () => loading,
  });

  $effect(() => {
    if (size === 'icon' && !ariaLabel) {
      console.warn(
        '[Button] size="icon" requires an ariaLabel prop for accessibility. See ui-spec-v02.md §8.1.',
      );
    }
  });

  $effect(() => {
    // Interactivity lost mid-press — a click that flips the button to `loading`
    // or `disabled`. `disabled` also kills pointer-events, so the matching
    // release would never land and the button would come back still pressed.
    // The teardown doubles as unmount cleanup: no floor timer outlives the page.
    if (!state.interactive) state.cancel();
    return () => state.cancel();
  });

  function handleClick(e: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    if (!state.interactive) {
      e.preventDefault();
      return;
    }
    onclick?.(e);
  }

  function handlePointerDown(e: PointerEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    // Secondary and middle buttons open menus / paste; they never activate a
    // button, so they must not press one either. (`> 0` rather than `!== 0` so a
    // pen or a synthetic event with no `button` still presses.)
    if (!(e.button > 0)) state.press();
    onpointerdown?.(e);
  }

  function handleKeyDown(e: KeyboardEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    // Held keys repeat keydown; `press()` is idempotent, but skipping the repeat
    // keeps the intent obvious.
    if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) state.press();
    onkeydown?.(e);
  }

  function handleKeyUp(e: KeyboardEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    if (e.key === ' ' || e.key === 'Enter') state.release();
    onkeyup?.(e);
  }
</script>

<button
  {type}
  class={cn(buttonVariants({ variant, size, fullWidth }), className)}
  disabled={state.disabled}
  data-disabled={state.disabled ? '' : undefined}
  data-loading={state.loading ? '' : undefined}
  data-pressed={state.pressed ? '' : undefined}
  aria-disabled={state.disabled || state.loading ? 'true' : undefined}
  aria-busy={state.loading ? 'true' : undefined}
  aria-label={ariaLabel}
  onclick={handleClick}
  onpointerdown={handlePointerDown}
  onpointerup={(e) => {
    state.release();
    onpointerup?.(e);
  }}
  onpointercancel={(e) => {
    state.release();
    onpointercancel?.(e);
  }}
  onpointerleave={(e) => {
    state.release();
    onpointerleave?.(e);
  }}
  onkeydown={handleKeyDown}
  onkeyup={handleKeyUp}
  onblur={(e) => {
    state.release();
    onblur?.(e);
  }}
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
