<script lang="ts">
  import { Button, TextField } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    AI_MODEL_DEFAULTS,
    AI_MODEL_ROLES,
    AI_FLOW_ROLES,
    AI_FLOW_IDS,
    type AiModelRole,
    type AiFlowId,
  } from '@salt/domain/schemas';
  import AdminGuard from './AdminGuard.svelte';
  import {
    appSettings,
    effectiveModels,
    effectiveFlowModels,
    isLoadingAppSettings,
    isAppSettingsCorrupt,
    setModelRole,
    resetModelRole,
    setFlowOverride,
    resetFlowOverride,
  } from '../../lib/appSettingsService.js';
  import { addToast } from '../../lib/toastStore.js';

  // Admin AI model settings (Phase 1). One free-text field per role; each
  // defaults to today's exact production model literal, so clearing a field (or
  // a missing/corrupt doc) falls back to the default. Changes take up to ~3
  // minutes to propagate (the CF resolver caches for 180s).
  //
  // Phase 2 adds an "Advanced: per-flow overrides" section: an optional override
  // for a single flow that takes precedence over its role's model. Same
  // field/save/reset pattern as the role cards.

  type RoleMeta = { role: AiModelRole; title: string; description: string };
  const ROLE_META: RoleMeta[] = [
    {
      role: 'fast',
      title: 'Fast model',
      description:
        'Used by quick text flows: entry/recipe parsing, canon arbitration, equipment, chat titles, and URL recipe import.',
    },
    {
      role: 'pro',
      title: 'Pro model',
      description: 'Used by Chef Chat, where answer quality matters more than latency.',
    },
    {
      role: 'embedding',
      title: 'Embedding model',
      description: 'Used to embed text for canon matching and recipe ingredient canonicalisation.',
    },
    {
      role: 'image',
      title: 'Image model',
      description: 'Used to generate canon-item icons.',
    },
  ];

  // Local edit buffer per role, seeded from the saved value (or empty so the
  // placeholder shows the default). Re-seeds whenever the saved doc changes.
  let drafts = $state<Record<AiModelRole, string>>({
    fast: '',
    pro: '',
    embedding: '',
    image: '',
  });
  let saving = $state<Record<AiModelRole, boolean>>({
    fast: false,
    pro: false,
    embedding: false,
    image: false,
  });

  $effect(() => {
    const s = $appSettings;
    for (const role of AI_MODEL_ROLES) {
      // Only mirror an explicit, non-default saved value into the field; leave
      // it blank when it equals the default so the placeholder communicates
      // "defaulting to X".
      const saved = s?.[role];
      drafts[role] = saved && saved !== AI_MODEL_DEFAULTS[role] ? saved : '';
    }
  });

  async function onSave(role: AiModelRole): Promise<void> {
    saving[role] = true;
    const result = await setModelRole(role, drafts[role]);
    saving[role] = false;
    if (result.kind !== 'ok') {
      addToast('Failed to save the model setting.', 'error');
    } else {
      addToast('Model setting saved. It may take up to ~3 minutes to take effect.', 'success');
    }
  }

  async function onReset(role: AiModelRole): Promise<void> {
    saving[role] = true;
    drafts[role] = '';
    const result = await resetModelRole(role);
    saving[role] = false;
    if (result.kind !== 'ok') {
      addToast('Failed to reset the model setting.', 'error');
    } else {
      addToast('Reset to default.', 'success');
    }
  }

  // ─── Phase 2: per-flow overrides ────────────────────────────────────────────
  // Human-readable label per flow id; the role is derived from AI_FLOW_ROLES.
  const FLOW_LABELS: Record<AiFlowId, string> = {
    arbitrateCanon: 'Canon arbitration',
    authorRecipe: 'Recipe author (librarian)',
    chefChat: 'Chef Chat',
    embedText: 'Embed text (callable)',
    extractRecipeFromUrl: 'Recipe import from URL',
    generateCanonIcon: 'Canon icon generation',
    generateChatTitle: 'Chat title generation',
    identifyEquipment: 'Equipment identification',
    parseEntry: 'Entry parsing',
    parseRecipeIngredients: 'Recipe ingredient parsing',
    populateEquipmentEntry: 'Equipment entry population',
    serverEmbedding: 'Server embedding (canon/recipe vectors)',
  };

  // Flow ids grouped by role, so the Advanced section mirrors the role cards.
  const FLOWS_BY_ROLE: { role: AiModelRole; flows: AiFlowId[] }[] = AI_MODEL_ROLES.map((role) => ({
    role,
    flows: AI_FLOW_IDS.filter((flowId) => AI_FLOW_ROLES[flowId] === role),
  })).filter((g) => g.flows.length > 0);

  const initialFlowDrafts = (): Record<AiFlowId, string> =>
    Object.fromEntries(AI_FLOW_IDS.map((id) => [id, ''])) as Record<AiFlowId, string>;
  const initialFlowSaving = (): Record<AiFlowId, boolean> =>
    Object.fromEntries(AI_FLOW_IDS.map((id) => [id, false])) as Record<AiFlowId, boolean>;

  let flowDrafts = $state<Record<AiFlowId, string>>(initialFlowDrafts());
  let flowSaving = $state<Record<AiFlowId, boolean>>(initialFlowSaving());
  // Whether the Advanced section is expanded. Auto-opens when any override is
  // already set so an admin lands on existing config.
  let showAdvanced = $state(false);

  $effect(() => {
    const s = $appSettings;
    let anyOverride = false;
    for (const flowId of AI_FLOW_IDS) {
      // Mirror only an explicitly-set override into the field; leave it blank
      // (placeholder shows the inherited role model) when no override exists.
      const saved = s?.perFlow?.[flowId];
      flowDrafts[flowId] = saved ?? '';
      if (saved) anyOverride = true;
    }
    if (anyOverride) showAdvanced = true;
  });

  async function onSaveFlow(flowId: AiFlowId): Promise<void> {
    flowSaving[flowId] = true;
    const result = await setFlowOverride(flowId, flowDrafts[flowId]);
    flowSaving[flowId] = false;
    if (result.kind !== 'ok') {
      addToast('Failed to save the flow override.', 'error');
    } else {
      addToast('Flow override saved. It may take up to ~3 minutes to take effect.', 'success');
    }
  }

  async function onResetFlow(flowId: AiFlowId): Promise<void> {
    flowSaving[flowId] = true;
    flowDrafts[flowId] = '';
    const result = await resetFlowOverride(flowId);
    flowSaving[flowId] = false;
    if (result.kind !== 'ok') {
      addToast('Failed to clear the flow override.', 'error');
    } else {
      addToast('Override cleared — flow now follows its role.', 'success');
    }
  }

  // True when a flow currently has an explicit override in the saved doc.
  const flowHasOverride = $derived.by(() => {
    const perFlow = $appSettings?.perFlow;
    const out = {} as Record<AiFlowId, boolean>;
    for (const flowId of AI_FLOW_IDS) {
      out[flowId] = Boolean(perFlow?.[flowId]);
    }
    return out;
  });

  const lastUpdatedLabel = $derived.by(() => {
    const s = $appSettings;
    if (!s?.updatedAt) return null;
    const when = new Date(s.updatedAt).toLocaleString();
    return s.updatedBy ? `Last changed by ${s.updatedBy} on ${when}` : `Last changed on ${when}`;
  });
</script>

<AdminGuard>
  <div class="flex flex-col gap-4 p-4 sm:p-6" data-testid="admin-app-settings">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">AI model settings</h1>
        <p class="text-sm text-muted-foreground">
          Choose the Gemini model for each AI role in <strong>this environment only</strong> (dev, staging
          and production each have their own).
        </p>
      </div>
      <Button size="sm" onclick={() => push('/admin')}>Back to admin</Button>
    </div>

    <div
      class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
      data-testid="app-settings-propagation-note"
    >
      Changes take up to ~3 minutes to propagate to running flows (each function caches the selected
      model for up to 180 seconds). Leave a field blank to use the default shown.
    </div>

    {#if $isAppSettingsCorrupt}
      <div
        class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        data-testid="app-settings-corrupt-warning"
      >
        The saved settings document is invalid and is being ignored — all roles are running on their
        defaults. Saving any field below will replace it with a valid document.
      </div>
    {/if}

    {#if lastUpdatedLabel}
      <p class="text-xs text-muted-foreground" data-testid="app-settings-audit">
        {lastUpdatedLabel}
      </p>
    {/if}

    <div class="flex flex-col gap-4">
      {#each ROLE_META as meta (meta.role)}
        <div class="rounded-lg border p-4" data-testid="app-settings-role-{meta.role}">
          <h2 class="text-base font-medium">{meta.title}</h2>
          <p class="mt-0.5 text-sm text-muted-foreground">{meta.description}</p>

          <p class="mt-2 text-sm" data-testid="app-settings-effective-{meta.role}">
            Effective model:
            <code class="rounded bg-muted px-1 py-0.5 text-xs">{$effectiveModels[meta.role]}</code>
            {#if $effectiveModels[meta.role] === AI_MODEL_DEFAULTS[meta.role]}
              <span class="text-muted-foreground">(default)</span>
            {/if}
          </p>

          {#if meta.role === 'embedding'}
            <div
              class="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="app-settings-embedding-warning"
            >
              <strong>Changing the embedding model requires a re-embed migration.</strong> Existing canon
              and recipe vectors were produced by the current model; a different model's vectors are not
              comparable, so matching quality will degrade until everything is re-embedded. Do not change
              this without a planned migration.
            </div>
          {/if}

          <div class="mt-3 flex items-end gap-2">
            <div class="flex-1">
              <TextField
                label={meta.title}
                placeholder={`Default: ${AI_MODEL_DEFAULTS[meta.role]}`}
                bind:value={drafts[meta.role]}
                disabled={$isLoadingAppSettings || saving[meta.role]}
                data-testid="app-settings-input-{meta.role}"
              />
            </div>
            <Button
              size="sm"
              onclick={() => void onSave(meta.role)}
              disabled={$isLoadingAppSettings || saving[meta.role]}
              data-testid="app-settings-save-{meta.role}"
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onclick={() => void onReset(meta.role)}
              disabled={$isLoadingAppSettings || saving[meta.role]}
              data-testid="app-settings-reset-{meta.role}"
            >
              Reset to default
            </Button>
          </div>
        </div>
      {/each}
    </div>

    <div class="rounded-lg border" data-testid="app-settings-advanced">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 p-4 text-left"
        onclick={() => (showAdvanced = !showAdvanced)}
        aria-expanded={showAdvanced}
        data-testid="app-settings-advanced-toggle"
      >
        <span>
          <span class="text-base font-medium">Advanced: per-flow overrides</span>
          <span class="mt-0.5 block text-sm text-muted-foreground">
            Override the model for a single flow. An override takes precedence over the flow's role;
            leave it blank to follow the role. For one-off experiments — most flows should follow
            their role.
          </span>
        </span>
        <span class="text-sm text-muted-foreground">{showAdvanced ? 'Hide' : 'Show'}</span>
      </button>

      {#if showAdvanced}
        <div class="flex flex-col gap-4 border-t p-4">
          {#each FLOWS_BY_ROLE as group (group.role)}
            <div data-testid="app-settings-flow-group-{group.role}">
              <h3 class="text-sm font-semibold text-muted-foreground uppercase">
                {group.role} role
              </h3>
              <div class="mt-2 flex flex-col gap-4">
                {#each group.flows as flowId (flowId)}
                  <div class="rounded-md border p-3" data-testid="app-settings-flow-{flowId}">
                    <p class="text-sm font-medium">{FLOW_LABELS[flowId]}</p>
                    <p class="mt-1 text-sm" data-testid="app-settings-flow-effective-{flowId}">
                      Effective model:
                      <code class="rounded bg-muted px-1 py-0.5 text-xs"
                        >{$effectiveFlowModels[flowId]}</code
                      >
                      {#if flowHasOverride[flowId]}
                        <span class="text-muted-foreground">(override)</span>
                      {:else}
                        <span class="text-muted-foreground">(follows {group.role} role)</span>
                      {/if}
                    </p>

                    <div class="mt-2 flex items-end gap-2">
                      <div class="flex-1">
                        <TextField
                          label="Model override"
                          placeholder={`Follows ${group.role} role: ${$effectiveModels[group.role]}`}
                          bind:value={flowDrafts[flowId]}
                          disabled={$isLoadingAppSettings || flowSaving[flowId]}
                          data-testid="app-settings-flow-input-{flowId}"
                        />
                      </div>
                      <Button
                        size="sm"
                        onclick={() => void onSaveFlow(flowId)}
                        disabled={$isLoadingAppSettings || flowSaving[flowId]}
                        data-testid="app-settings-flow-save-{flowId}"
                      >
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onclick={() => void onResetFlow(flowId)}
                        disabled={$isLoadingAppSettings ||
                          flowSaving[flowId] ||
                          !flowHasOverride[flowId]}
                        data-testid="app-settings-flow-reset-{flowId}"
                      >
                        Reset to role
                      </Button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</AdminGuard>
