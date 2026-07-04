<!-- Composition wrapper for FormPage.stories.ts. FormPage renders a <form> with a
     built-in Save/Cancel footer and a `children` snippet for the fields — a single
     `component` + `args` cannot supply the field snippet, so we compose a couple of
     TextFields here and drive the header/footer state from plain controls. The
     onSubmit/onCancel handlers are no-ops (static story). Rule 7: only
     @salt/ui-components. -->
<script lang="ts">
  import { FormPage, TextField } from '@salt/ui-components';

  let {
    title = 'Add recipe',
    description = 'Fill in the details below.',
    submitLabel = 'Save',
    cancelLabel = 'Cancel',
    isSubmitting = false,
    canSubmit = true,
  }: {
    title?: string;
    description?: string;
    submitLabel?: string;
    cancelLabel?: string;
    isSubmitting?: boolean;
    canSubmit?: boolean;
  } = $props();

  const noop = () => {};
</script>

<div class="w-full max-w-lg">
  <FormPage
    {title}
    {description}
    {submitLabel}
    {cancelLabel}
    {isSubmitting}
    {canSubmit}
    onSubmit={noop}
    onCancel={noop}
  >
    <TextField label="Recipe name" placeholder="Weeknight pasta" />
    <TextField label="Servings" type="text" placeholder="4" />
  </FormPage>
</div>
