<!-- spec: SPEC.md §6 v0.3 — test fixture for Select composition -->
<script lang="ts">
  import Select from '../../src/primitives/Select/Select.svelte';
  import SelectTrigger from '../../src/primitives/Select/SelectTrigger.svelte';
  import SelectContent from '../../src/primitives/Select/SelectContent.svelte';
  import SelectItem from '../../src/primitives/Select/SelectItem.svelte';
  import SelectGroup from '../../src/primitives/Select/SelectGroup.svelte';
  import SelectLabel from '../../src/primitives/Select/SelectLabel.svelte';
  import SelectSeparator from '../../src/primitives/Select/SelectSeparator.svelte';

  let {
    value = $bindable<string | undefined>(undefined),
    defaultValue,
    open = $bindable<boolean | undefined>(undefined),
    defaultOpen,
    disabled = false,
    required = false,
    name,
    placeholder = 'Pick a fruit…',
    portal = false,
    onValueChange,
    onOpenChange,
  }: {
    value?: string;
    defaultValue?: string;
    open?: boolean;
    defaultOpen?: boolean;
    disabled?: boolean;
    required?: boolean;
    name?: string;
    placeholder?: string;
    portal?: HTMLElement | string | false;
    onValueChange?: (value: string) => void;
    onOpenChange?: (open: boolean) => void;
  } = $props();
</script>

<Select
  bind:value
  {defaultValue}
  bind:open
  {defaultOpen}
  {disabled}
  {required}
  {name}
  {placeholder}
  {portal}
  {onValueChange}
  {onOpenChange}
>
  <SelectTrigger />
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Fruits</SelectLabel>
      <SelectItem value="apple" label="Apple" />
      <SelectItem value="banana" label="Banana" />
      <SelectSeparator />
      <SelectItem value="orange" label="Orange" disabled />
    </SelectGroup>
  </SelectContent>
</Select>
