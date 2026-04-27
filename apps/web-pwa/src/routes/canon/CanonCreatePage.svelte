<script lang="ts">
  import { FormPage, TextField } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
</script>

<div class="p-4 sm:p-6">
  <FormPage
    title="Add ingredient"
    description="Add a new canonical ingredient to the database."
    submitLabel="Save ingredient"
    onCancel={() => push('/canon')}
  >
    <TextField label="Name" placeholder="e.g. Unsalted Butter" required />
  </FormPage>
</div>
