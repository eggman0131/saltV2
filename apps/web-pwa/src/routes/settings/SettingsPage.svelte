<script lang="ts">
  import {
    FormPage,
    Text,
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
    TextArea,
    Button,
    Switch,
  } from '@salt/ui-components';
  import { auth } from '../../lib/auth.svelte.js';
  import { submitFeedback } from '../../lib/observability.js';
  import { push } from '../../lib/push.svelte.js';
  import { install } from '../../lib/install.svelte.js';
  import AddToHomeScreen from '../../components/AddToHomeScreen.svelte';

  // Cook-timer notifications (issue #544). The toggle must run its permission
  // request from this click (iOS requires a user gesture); the push store handles
  // subscribe/unsubscribe + persistence and reflects the outcome back here.
  async function onToggleNotifications(next: boolean): Promise<void> {
    const uid = auth.user?.uid;
    if (!uid) return;
    if (next) await push.enable(uid);
    else await push.disable(uid);
  }

  // Build stamp injected at build time (vite.config.ts). The timestamp makes
  // every build distinct, so it doubles as the "did the PWA auto-update?" signal.
  const version = __APP_VERSION__;
  const builtAt = new Date(__APP_BUILD_TIME__);
  const builtAtLabel = Number.isNaN(builtAt.getTime())
    ? __APP_BUILD_TIME__
    : builtAt.toLocaleString();
  const environment = import.meta.env.MODE;

  // Feedback box — pipes the message into PostHog Support (the same inbox the
  // floating chat widget would use), so it arrives with the session replay +
  // exceptions attached and can be replied to. Best-effort: a false result just
  // surfaces a retry message.
  let feedback = $state('');
  let status = $state<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function sendFeedback() {
    const text = feedback.trim();
    if (!text || status === 'sending') return;
    status = 'sending';
    const ok = await submitFeedback(text, auth.user?.email ?? undefined);
    if (ok) {
      feedback = '';
      status = 'sent';
    } else {
      status = 'error';
    }
  }
</script>

<div class="p-4 sm:p-6 space-y-6">
  <FormPage title="Settings" description="Manage your account." canSubmit={false}>
    <!-- Empty footer: an informational page has nothing to save, so suppress
         FormPage's default (disabled) Save button. -->
    {#snippet footer()}{/snippet}
    <Text muted>Signed in as {auth.user?.email ?? '—'}</Text>

    <div class="mt-2 space-y-1 border-t pt-4">
      <Text muted>Environment: {environment}</Text>
      <Text muted>Version: {version}</Text>
      <Text muted>Built: {builtAtLabel}</Text>
    </div>
  </FormPage>

  <AddToHomeScreen />

  <Card>
    <CardHeader>
      <CardTitle>Cook notifications</CardTitle>
      <CardDescription>
        Get a sound and a notification when a cook timer finishes — even when Salt is in the
        background or closed.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      {#if !push.supported}
        <Text muted>This browser doesn't support notifications.</Text>
      {:else if install.isIosSafari && !install.isStandalone}
        <Text muted>
          On iPhone or iPad, add Salt to your Home Screen first (see above) — notifications only
          work in the installed app.
        </Text>
      {:else if !push.configured}
        <Text muted>Notifications aren't configured for this environment yet.</Text>
      {:else}
        <div data-testid="settings-cook-notifications">
          <Switch
            checked={push.enabled}
            disabled={push.busy}
            onCheckedChange={onToggleNotifications}
            label="Enable cook notifications"
            description="Turning this on asks for notification permission on this device."
          />
        </div>
        {#if push.permissionDenied}
          <Text class="text-sm text-destructive">
            Notifications are blocked for Salt in your browser or system settings — allow them
            there, then try again.
          </Text>
        {:else if push.error}
          <Text class="text-sm text-destructive">{push.error}</Text>
        {/if}
      {/if}
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Send feedback</CardTitle>
      <CardDescription>
        Hit a bug or have an idea? Send it straight to me — it lands in our inbox with the page you
        were on attached.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <TextArea
        label="Your message"
        placeholder="What went wrong, or what would you like to see?"
        rows={4}
        maxLength={2000}
        bind:value={feedback}
        disabled={status === 'sending'}
        error={status === 'error' ? "Couldn't send — please try again." : undefined}
        onValueChange={() => {
          if (status === 'sent' || status === 'error') status = 'idle';
        }}
      />
      {#if status === 'sent'}
        <Text class="text-sm text-emerald-600">Thanks — your feedback's on its way. 💚</Text>
      {/if}
    </CardContent>
    <CardFooter class="justify-end">
      <Button
        onclick={sendFeedback}
        loading={status === 'sending'}
        disabled={feedback.trim().length === 0}
      >
        Submit feedback
      </Button>
    </CardFooter>
  </Card>
</div>
