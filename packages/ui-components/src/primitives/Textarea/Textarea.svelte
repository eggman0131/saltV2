<!-- spec: SPEC.md §8.3 v0.2.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { cn } from '../../lib/cn';
  import { createTextFieldState } from '../../headless/TextField.headless.svelte';
  import { textareaFrameVariants } from './Textarea.variants';
  import type { TextareaProps } from './Textarea.types';

  let {
    value = $bindable(),
    defaultValue = '',
    label,
    description,
    error,
    placeholder,
    size = 'md',
    rows = 3,
    autoresize = false,
    maxLength,
    disabled = false,
    readonly: readOnly = false,
    required = false,
    name,
    id: idProp,
    class: className,
    onValueChange,
    onfocus,
    onblur,
    ...rest
  }: TextareaProps = $props();

  if (value === undefined) value = untrack(() => defaultValue);

  const fieldState = createTextFieldState({
    id: () => idProp,
    error: () => error,
    description: () => description,
  });

  let textareaEl: HTMLTextAreaElement | undefined = $state(undefined);

  $effect(() => {
    if (autoresize && textareaEl) {
      textareaEl.style.height = 'auto';
      textareaEl.style.height = `${textareaEl.scrollHeight}px`;
    }
  });

  function handleInput(e: Event) {
    const next = (e.target as HTMLTextAreaElement).value;
    value = next;
    onValueChange?.(next);
    if (autoresize && textareaEl) {
      textareaEl.style.height = 'auto';
      textareaEl.style.height = `${textareaEl.scrollHeight}px`;
    }
  }
</script>

<div class={cn('flex flex-col gap-1.5', className)}>
  <label class="text-sm font-medium text-foreground" for={fieldState.id}>
    {label}
  </label>

  <div
    class={textareaFrameVariants({
      size,
      error: !!error,
      disabled,
    })}
  >
    <textarea
      bind:this={textareaEl}
      id={fieldState.id}
      {placeholder}
      {name}
      {disabled}
      readonly={readOnly}
      {required}
      {rows}
      maxlength={maxLength}
      value={value ?? ''}
      aria-required={required ? 'true' : undefined}
      aria-invalid={fieldState.hasError ? 'true' : undefined}
      aria-describedby={fieldState.describedBy}
      class="flex-1 appearance-none border-0 bg-transparent outline-none resize-none py-2 placeholder:text-muted-foreground"
      oninput={handleInput}
      {onfocus}
      {onblur}
      {...rest}></textarea>
  </div>

  {#if description}
    <span id={fieldState.descId} class="text-sm text-muted-foreground">{description}</span>
  {/if}

  {#if error}
    <span id={fieldState.errorId} role="alert" class="text-sm text-destructive">{error}</span>
  {/if}
</div>
