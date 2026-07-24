<!-- Install affordance (issue #545). Renders nothing when the app already runs
     standalone. On iOS Safari (not installed) it shows the Share → Add to Home
     Screen steps; on Android/desktop Chromium it shows a native "Install" button
     wired to the captured beforeinstallprompt event. Dismissal is in-memory,
     per instance (Rule 3: no storage) — acceptable because the whole thing
     self-hides forever once the app is standalone. -->
<script lang="ts">
  import { Button, Icon } from '@salt/ui-components';
  import { install } from '../lib/install.svelte.js';

  let { class: className = '' }: { class?: string } = $props();

  let dismissed = $state(false);

  // iOS Safari, not yet installed → the manual Add-to-Home-Screen explainer.
  const showIosExplainer = $derived(!install.isStandalone && install.isIosSafari && !dismissed);
  // Android / desktop Chromium offered us a deferred prompt → native button.
  const showInstallButton = $derived(
    !install.isStandalone && install.canPromptInstall && !dismissed,
  );
  const visible = $derived(showIosExplainer || showInstallButton);

  async function onInstall(): Promise<void> {
    await install.promptInstall();
  }
</script>

{#if visible}
  <div class="rounded-lg border bg-card p-4 {className}" data-testid="add-to-home-screen">
    {#if showIosExplainer}
      <div class="flex items-start gap-3">
        <Icon name="Smartphone" size={20} class="mt-0.5 shrink-0 text-primary" />
        <div class="min-w-0 flex-1 space-y-2">
          <p class="text-sm font-medium">Add Salt to your Home Screen</p>
          <p class="text-sm text-muted-foreground">
            Installed, Salt runs full-screen, launches like an app, and can alert you when a cook
            timer finishes.
          </p>
          <ol class="space-y-1.5 text-sm text-muted-foreground">
            <li class="flex flex-wrap items-center gap-1.5">
              <span class="font-medium text-foreground">1.</span>
              <span>Tap the Share button</span>
              <Icon name="Share" size={16} class="shrink-0" />
            </li>
            <li class="flex flex-wrap items-center gap-1.5">
              <span class="font-medium text-foreground">2.</span>
              <span>Choose</span>
              <span class="inline-flex items-center gap-1 font-medium text-foreground">
                Add to Home Screen
                <Icon name="SquarePlus" size={16} class="shrink-0" />
              </span>
            </li>
          </ol>
        </div>
        <Button
          variant="ghost"
          size="icon"
          ariaLabel="Dismiss install instructions"
          onclick={() => (dismissed = true)}
          data-testid="add-to-home-screen-dismiss"
        >
          <Icon name="X" size={16} />
        </Button>
      </div>
    {:else if showInstallButton}
      <div class="flex items-center gap-3">
        <Icon name="Smartphone" size={20} class="shrink-0 text-primary" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">Install Salt</p>
          <p class="text-sm text-muted-foreground">Runs full-screen and launches like an app.</p>
        </div>
        <Button size="sm" onclick={onInstall} data-testid="add-to-home-screen-install">
          Install
        </Button>
      </div>
    {/if}
  </div>
{/if}
