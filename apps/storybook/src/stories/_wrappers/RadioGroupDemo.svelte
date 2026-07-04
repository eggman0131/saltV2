<!-- Composition wrapper for RadioGroup.stories.ts. RadioGroup is a compound
     component (RadioGroup root + N RadioGroupItem children wired through context)
     that a single `component` + `args` cannot express, so we compose a fixed set
     of items here and drive the root with plain-prop/boolean controls. Optional
     props (value/description/error) use conditional spread so no `undefined` is
     forwarded under exactOptionalPropertyTypes. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { RadioGroup, RadioGroupItem } from '@salt/ui-components';

  let {
    label = 'Notify me about',
    description = '',
    error = '',
    orientation = 'vertical',
    disabled = false,
    value = '',
  }: {
    label?: string;
    description?: string;
    error?: string;
    orientation?: 'horizontal' | 'vertical';
    disabled?: boolean;
    value?: string;
  } = $props();
</script>

<RadioGroup
  {label}
  {orientation}
  {disabled}
  {...description ? { description } : {}}
  {...error ? { error } : {}}
  {...value ? { value } : {}}
>
  <RadioGroupItem value="all" label="All new recipes" />
  <RadioGroupItem value="mentions" label="When I'm mentioned" />
  <RadioGroupItem value="none" label="Nothing" />
</RadioGroup>
