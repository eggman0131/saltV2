<script lang="ts">
  import { FormPage, Text } from '@salt/ui-components';
  import { auth } from '../../lib/auth.svelte.js';
</script>

<div class="p-4 sm:p-6">
  <FormPage title="Settings" description="Manage your account." canSubmit={false}>
    <Text muted>Signed in as {auth.user?.email ?? '—'}</Text>
  </FormPage>
</div>
