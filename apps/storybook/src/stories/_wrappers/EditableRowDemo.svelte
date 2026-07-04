<!-- Composition wrapper for EditableRow.stories.ts. EditableRow renders an <li>
     (so it is wrapped in a <ul> here) and takes `narrow` (mobile, <sm) + `wide`
     (>=sm) snippets that a single `component` + `args` cannot express. A
     `withToggle` boolean decides whether `onToggleSelect` is passed — when defined
     the row renders a leading Checkbox. The handler is passed via conditional
     spread so no `undefined` is forwarded under exactOptionalPropertyTypes.
     Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { EditableRow, Button } from '@salt/ui-components';

  let {
    selected = false,
    shaded = false,
    withToggle = false,
  }: {
    selected?: boolean;
    shaded?: boolean;
    withToggle?: boolean;
  } = $props();

  // No-op: the story is static; toggling state is exercised in the app, not here.
  const noop = () => {};
</script>

<ul class="w-80 space-y-2">
  <EditableRow {selected} {shaded} {...withToggle ? { onToggleSelect: noop } : {}}>
    {#snippet narrow()}
      <span class="truncate text-sm font-medium">Tinned tomatoes</span>
    {/snippet}
    {#snippet wide()}
      <span class="flex-1 truncate text-sm font-medium">Tinned tomatoes</span>
      <span class="text-xs text-muted-foreground">Produce</span>
      <Button variant="ghost" size="sm">Edit</Button>
    {/snippet}
  </EditableRow>
</ul>
