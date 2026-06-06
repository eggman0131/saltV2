<script lang="ts">
  import { FormPage, Text } from '@salt/ui-components';
  import { auth } from '../../lib/auth.svelte.js';

  // Build stamp injected at build time (vite.config.ts). The timestamp makes
  // every build distinct, so it doubles as the "did the PWA auto-update?" signal.
  const commit = __APP_COMMIT__;
  const builtAt = new Date(__APP_BUILD_TIME__);
  const builtAtLabel = Number.isNaN(builtAt.getTime())
    ? __APP_BUILD_TIME__
    : builtAt.toLocaleString();
  const environment = import.meta.env.MODE;
</script>

<div class="p-4 sm:p-6">
  <FormPage title="Settings" description="Manage your account." canSubmit={false}>
    <Text muted>Signed in as {auth.user?.email ?? '—'}</Text>

    <div class="mt-6 space-y-1 border-t pt-4">
      <Text muted>Environment: {environment}</Text>
      <Text muted>Version: {commit}</Text>
      <Text muted>Built: {builtAtLabel}</Text>
    </div>
  </FormPage>
</div>
