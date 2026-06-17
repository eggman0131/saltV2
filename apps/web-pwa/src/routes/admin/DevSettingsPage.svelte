<script lang="ts">
  import { Button, Switch } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import AdminGuard from './AdminGuard.svelte';
  import {
    canonIconGenerationEnabled,
    isLoadingDevSettings,
    setCanonIconGenerationEnabled,
  } from '../../lib/devSettingsService.js';
  import { addToast } from '../../lib/toastStore.js';

  // Development settings (issue #238). Per-environment operator switches. The
  // store/CF both default to enabled, so the toggle reflects effective state
  // even before the doc exists.
  async function onToggleIconGeneration(enabled: boolean): Promise<void> {
    const result = await setCanonIconGenerationEnabled(enabled);
    if (result.kind !== 'ok') {
      addToast('Failed to save the icon-generation setting.', 'error');
    }
  }
</script>

<AdminGuard>
  <div class="flex flex-col gap-4 p-4 sm:p-6" data-testid="admin-dev-settings">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Development settings</h1>
        <p class="text-sm text-muted-foreground">
          Operator switches that apply to <strong>this environment only</strong> (dev, staging and production
          each have their own).
        </p>
      </div>
      <Button size="sm" onclick={() => push('/admin')}>Back to admin</Button>
    </div>

    <div class="rounded-lg border p-4" data-testid="canon-icon-generation-setting">
      <Switch
        label="Canon icon generation"
        description="When off, no canon-item icons are generated in this environment — covering new items, the background self-heal, and the manual Regenerate button. Turn it off before bulk canon edits to avoid AI spend, then back on to resume. Re-enabling does NOT backfill items created while off; they only get an icon when next edited or manually regenerated."
        checked={$canonIconGenerationEnabled}
        disabled={$isLoadingDevSettings}
        onCheckedChange={(c) => void onToggleIconGeneration(c)}
      />
    </div>
  </div>
</AdminGuard>
