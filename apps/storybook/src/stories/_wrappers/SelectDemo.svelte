<!-- Composition wrapper for Select.stories.ts. Select is a compound component:
     the root provides context and SelectTrigger/SelectContent/SelectItem
     self-register through it, so a single `component` + `args` cannot express it.
     `portal={false}` renders the open menu INLINE in the story canvas (default
     'body' would teleport it out of the story root — worse for isolation and for
     the eventual Chromatic snapshot). `open` is exposed as a control so toggling
     it in the Controls panel opens the menu. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { Select, SelectTrigger, SelectContent, SelectItem } from '@salt/ui-components';

  let {
    open = false,
    disabled = false,
    value = '',
    placeholder = 'Pick an aisle',
  }: {
    open?: boolean;
    disabled?: boolean;
    value?: string;
    placeholder?: string;
  } = $props();
</script>

<div class="w-64">
  <Select {open} {disabled} {placeholder} portal={false} {...value ? { value } : {}}>
    <SelectTrigger />
    <SelectContent>
      <SelectItem value="produce" label="Produce" />
      <SelectItem value="dairy" label="Dairy" />
      <SelectItem value="bakery" label="Bakery" />
      <SelectItem value="frozen" label="Frozen" disabled />
    </SelectContent>
  </Select>
</div>
