<!-- spec: SPEC.md §2 v0.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { cn } from '../../lib/cn';
  import { useId } from '../../lib/useId';
  import {
    RADIO_GROUP_CONTEXT,
    createRadioGroupState,
    type RadioGroupRegisteredItem,
  } from '../../headless/RadioGroup.headless.svelte';
  import { radioGroupVariants } from './RadioGroup.variants';
  import type { RadioGroupProps } from './RadioGroup.types';

  let {
    value = $bindable(),
    defaultValue,
    name,
    orientation = 'vertical',
    disabled = false,
    required = false,
    label,
    description,
    error,
    class: className,
    children,
    onValueChange,
  }: RadioGroupProps = $props();

  // $state.raw prevents Svelte from deep-proxying HTMLElement references inside items.
  // Reference replacement (not mutation) is used in addItem/removeItem to trigger updates.
  let items = $state.raw<RadioGroupRegisteredItem[]>([]);
  let rovingValue = $state<string | undefined>(undefined);

  // Canonical §3.6 seed — only reads defaultValue once (intentional, not reactive)
  if (value === undefined) value = defaultValue;

  const labelId = useId('rg-label');
  const descId = useId('rg-desc');
  const errorId = useId('rg-error');
  const generatedName = useId('rg-name');

  const rgState = createRadioGroupState({
    value: () => value,
    setValue: (v) => {
      value = v;
      onValueChange?.(v);
    },
    name: () => name ?? generatedName,
    orientation: () => orientation,
    disabled: () => disabled,
    required: () => required,
    labelId,
    // Always pass stable IDs; root template conditionally renders description/error elements
    descId,
    errorId,
    getItems: () => items,
    addItem: (val, el, itemDisabled) => {
      const current = untrack(() => items);
      const idx = current.findIndex((i) => i.value === val);
      if (idx !== -1) {
        items = current.map((i, j) => (j === idx ? { value: val, el, disabled: itemDisabled } : i));
      } else {
        items = [...current, { value: val, el, disabled: itemDisabled }];
      }
    },
    removeItem: (val) => {
      items = untrack(() => items).filter((i) => i.value !== val);
    },
    getRovingValue: () => rovingValue,
    setRovingValue: (val) => {
      rovingValue = val;
    },
  });

  RADIO_GROUP_CONTEXT.set(rgState);

  const describedBy = $derived.by(() => {
    const ids: string[] = [];
    if (error) ids.push(errorId);
    if (description) ids.push(descId);
    return ids.length ? ids.join(' ') : undefined;
  });
</script>

<fieldset
  role="radiogroup"
  aria-labelledby={labelId}
  aria-describedby={describedBy}
  aria-required={required || undefined}
  aria-disabled={disabled || undefined}
  class={cn('m-0 border-0 p-0', className)}
>
  <legend id={labelId} class="mb-1 text-sm font-medium text-foreground">{label}</legend>

  {#if description}
    <p id={descId} class="mb-2 text-sm text-muted-foreground">{description}</p>
  {/if}

  <div class={radioGroupVariants({ orientation })}>
    {@render children?.()}
  </div>

  {#if error}
    <p id={errorId} role="alert" class="mt-1 text-sm text-destructive">{error}</p>
  {/if}
</fieldset>
