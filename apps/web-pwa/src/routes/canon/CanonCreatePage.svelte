<script lang="ts">
  import { FormPage, TextField } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { addCanonItem } from '../../lib/canonService.js';

  let name = $state('');
  let errorMessage = $state('');
  let saving = $state(false);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    saving = true;
    errorMessage = '';
    const result = await addCanonItem(trimmed);
    saving = false;
    if (result.kind === 'ok') {
      push('/canon');
    } else {
      errorMessage = 'Failed to save ingredient. Please try again.';
    }
  }
</script>

<div class="p-4 sm:p-6">
  <FormPage
    title="Add ingredient"
    description="Add a new canonical ingredient to the database."
    submitLabel="Save ingredient"
    isSubmitting={saving}
    canSubmit={name.trim().length > 0}
    onSubmit={handleSubmit}
    onCancel={() => push('/canon')}
  >
    <TextField
      label="Name"
      placeholder="e.g. Unsalted Butter"
      value={name}
      onValueChange={(v) => (name = v)}
      error={errorMessage}
      required
    />
  </FormPage>
</div>
