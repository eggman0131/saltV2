<!-- spec: SPEC.md §8.4 v0.2.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Checkbox } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { createCheckboxState } from '../../headless/Checkbox.headless.svelte';
  import { checkboxRootVariants } from './Checkbox.variants';
  import type { CheckboxProps, CheckedState } from './Checkbox.types';

  let {
    checked = $bindable(),
    defaultChecked = false,
    label,
    labelledBy,
    description,
    error,
    disabled = false,
    required = false,
    name,
    value = 'on',
    size = 'md',
    class: className,
    children,
    onCheckedChange,
    ...rest
  }: CheckboxProps & { onCheckedChange?: (checked: CheckedState) => void } = $props();

  if (checked === undefined) checked = untrack(() => defaultChecked);

  const fieldState = createCheckboxState({
    id: () => undefined,
    error: () => error,
    description: () => description,
  });

  // Translate our CheckedState to bits-ui's separate boolean props
  const bitsChecked = $derived(checked !== 'indeterminate' ? (checked ?? false) : false);
  const bitsIndeterminate = $derived(checked === 'indeterminate');

  function handleCheckedChange(newChecked: boolean) {
    checked = newChecked;
    onCheckedChange?.(newChecked);
  }
</script>

<div class={cn('flex items-start gap-2', className)} {...rest}>
  <Checkbox.Root
    id={fieldState.id}
    checked={bitsChecked}
    indeterminate={bitsIndeterminate}
    onCheckedChange={handleCheckedChange}
    {disabled}
    {required}
    {name}
    {value}
    aria-labelledby={labelledBy}
    aria-describedby={fieldState.describedBy}
    class={cn('peer', checkboxRootVariants({ size }))}
  >
    {#if bitsChecked || bitsIndeterminate}
      <div class="flex items-center justify-center text-current">
        {#if bitsIndeterminate}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="2"
            viewBox="0 0 10 2"
            fill="none"
            aria-hidden="true"
          >
            <line
              x1="1"
              y1="1"
              x2="9"
              y2="1"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        {:else}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="8"
            viewBox="0 0 10 8"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 4L3.5 6.5L9 1"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        {/if}
      </div>
    {/if}
  </Checkbox.Root>

  {#if children || label}
    <div class="flex flex-col gap-0.5">
      {#if children}
        <label
          for={fieldState.id}
          class="text-sm font-medium text-foreground peer-data-[disabled]:opacity-50"
        >
          {@render children()}
        </label>
      {:else if label}
        <label
          for={fieldState.id}
          class="text-sm font-medium text-foreground peer-data-[disabled]:opacity-50"
        >
          {label}
        </label>
      {/if}

      {#if description}
        <span id={fieldState.descId} class="text-sm text-muted-foreground">{description}</span>
      {/if}

      {#if error}
        <span id={fieldState.errorId} role="alert" class="text-sm text-destructive">{error}</span>
      {/if}
    </div>
  {/if}
</div>
