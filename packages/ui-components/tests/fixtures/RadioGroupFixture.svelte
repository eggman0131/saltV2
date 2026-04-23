<!-- spec: SPEC.md §6 v0.3 — test fixture for RadioGroup composition -->
<script lang="ts">
  import RadioGroup from '../../src/primitives/RadioGroup/RadioGroup.svelte';
  import RadioGroupItem from '../../src/primitives/RadioGroup/RadioGroupItem.svelte';

  let {
    value = $bindable<string | undefined>(undefined),
    defaultValue,
    orientation = 'vertical',
    disabled = false,
    required = false,
    label = 'Favourite fruit',
    description,
    error,
    onValueChange,
  }: {
    value?: string;
    defaultValue?: string;
    orientation?: 'horizontal' | 'vertical';
    disabled?: boolean;
    required?: boolean;
    label?: string;
    description?: string;
    error?: string;
    onValueChange?: (value: string) => void;
  } = $props();
</script>

<RadioGroup
  bind:value
  {defaultValue}
  {orientation}
  {disabled}
  {required}
  {label}
  {description}
  {error}
  {onValueChange}
>
  <RadioGroupItem value="apple" label="Apple" />
  <RadioGroupItem value="banana" label="Banana" />
  <RadioGroupItem value="orange" label="Orange" disabled />
</RadioGroup>
