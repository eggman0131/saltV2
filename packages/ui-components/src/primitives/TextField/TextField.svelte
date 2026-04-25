<!-- spec: SPEC.md §8.2 v0.2.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { cn } from '../../lib/cn';
  import { createTextFieldState } from '../../headless/TextField.headless.svelte';
  import { textFieldFrameVariants } from './TextField.variants';
  import type { TextFieldProps } from './TextField.types';

  let {
    value = $bindable(),
    defaultValue = '',
    label,
    description,
    error,
    type = 'text',
    placeholder,
    size = 'md',
    disabled = false,
    readonly: readOnly = false,
    required = false,
    autocomplete,
    name,
    id: idProp,
    class: className,
    leading,
    trailing,
    onValueChange,
    onfocus,
    onblur,
    ...rest
  }: TextFieldProps = $props();

  if (value === undefined) value = untrack(() => defaultValue);

  const state = createTextFieldState({
    id: () => idProp,
    error: () => error,
    description: () => description,
  });

  function handleInput(e: Event) {
    const next = (e.target as HTMLInputElement).value;
    value = next;
    onValueChange?.(next);
  }
</script>

<div class={cn('flex flex-col gap-1.5', className)}>
  <label class="text-sm font-medium text-foreground" for={state.id}>
    {label}
  </label>

  <div
    class={textFieldFrameVariants({
      size,
      error: !!error,
      disabled,
    })}
  >
    {#if leading}
      {@render leading()}
    {/if}

    <input
      id={state.id}
      {type}
      {placeholder}
      {name}
      {disabled}
      readonly={readOnly}
      {required}
      autocomplete={autocomplete as HTMLInputElement['autocomplete']}
      value={value ?? ''}
      aria-required={required ? 'true' : undefined}
      aria-invalid={state.hasError ? 'true' : undefined}
      aria-describedby={state.describedBy}
      class="flex-1 appearance-none border-0 bg-transparent outline-none placeholder:text-muted-foreground"
      oninput={handleInput}
      {onfocus}
      {onblur}
      {...rest}
    />

    {#if trailing}
      {@render trailing()}
    {/if}
  </div>

  {#if description}
    <span id={state.descId} class="text-sm text-muted-foreground">{description}</span>
  {/if}

  {#if error}
    <span id={state.errorId} role="alert" class="text-sm text-destructive">{error}</span>
  {/if}
</div>
