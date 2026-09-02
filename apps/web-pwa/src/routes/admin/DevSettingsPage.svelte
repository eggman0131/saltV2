<script lang="ts">
  import { Button, Switch } from '@salt/ui-components';
  import { goBack } from '../../lib/nav.js';
  import AdminGuard from './AdminGuard.svelte';
  import {
    canonIconGenerationEnabled,
    recipeImageGenerationEnabled,
    isLoadingDevSettings,
    setCanonIconGenerationEnabled,
    setRecipeImageGenerationEnabled,
  } from '../../lib/devSettingsService.js';
  import { addToast } from '../../lib/toastStore.js';

  // Development settings (issue #238). Per-environment operator switches. The
  // store/CF both default to enabled, so the toggle reflects effective state
  // even before the doc exists.

  // ONE flag covers all four pictogram families — canon items, product forms,
  // equipment and kitchen tools — a decision taken in #871 and re-taken in #877
  // and #882. This sentence used to name only canon-item icons, so an operator
  // flipping it off before a bulk canon edit was not told the appliance and tool
  // drawings stopped too (issue #935).
  //
  // The family list is PROSE and cannot be derived: the flag's readers are Cloud
  // Functions triggers and `web-pwa` must not import `cloud-functions`
  // (CLAUDE.md Rule 6). So this is checked by hand against the callers of
  // `isIconGenerationEnabled` in `apps/cloud-functions/src` — today
  // `triggers/iconWriteTrigger.ts` (canon items via `maybeGenerateIcon`, product
  // forms and kitchen tools via `iconWriteTrigger`),
  // `triggers/onEquipmentManifestWritten.ts` and `callables/drawEquipmentIcon.ts`.
  // Add a fifth family there and this sentence is the thing that goes stale;
  // nothing here will notice.
  const ICON_GENERATION_DESCRIPTION =
    'When off, no pictograms are generated in this environment — canon-item icons, ' +
    'product-form icons, equipment pictograms and kitchen-tool pictograms all stop, ' +
    'covering new items, the background self-heal, and the manual Regenerate button. ' +
    'Turn it off before bulk canon edits to avoid AI spend, then back on to resume. ' +
    'Re-enabling does NOT backfill items created while off; they only get an icon when ' +
    'next edited or manually regenerated.';
  async function onToggleIconGeneration(enabled: boolean): Promise<void> {
    const result = await setCanonIconGenerationEnabled(enabled);
    if (result.kind !== 'ok') {
      addToast('Failed to save the icon-generation setting.', 'destructive');
    }
  }

  async function onToggleRecipeImageGeneration(enabled: boolean): Promise<void> {
    const result = await setRecipeImageGenerationEnabled(enabled);
    if (result.kind !== 'ok') {
      addToast('Failed to save the recipe-image setting.', 'destructive');
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
      <Button size="sm" onclick={() => goBack('/admin')}>Back to admin</Button>
    </div>

    <div class="rounded-lg border p-4" data-testid="canon-icon-generation-setting">
      <Switch
        label="Canon icon generation"
        description={ICON_GENERATION_DESCRIPTION}
        checked={$canonIconGenerationEnabled}
        disabled={$isLoadingDevSettings}
        onCheckedChange={(c) => void onToggleIconGeneration(c)}
      />
    </div>

    <div class="rounded-lg border p-4" data-testid="recipe-image-generation-setting">
      <Switch
        label="Recipe image generation"
        description="When off, no recipe hero images are generated in this environment — covering new recipes and the manual Regenerate button. Recipe photos use a costlier model path, so turn this off before bulk recipe imports to avoid AI spend, then back on to resume. Re-enabling does NOT backfill recipes created while off; they only get an image when regenerated."
        checked={$recipeImageGenerationEnabled}
        disabled={$isLoadingDevSettings}
        onCheckedChange={(c) => void onToggleRecipeImageGeneration(c)}
      />
    </div>
  </div>
</AdminGuard>
