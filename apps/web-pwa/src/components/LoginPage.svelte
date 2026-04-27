<script lang="ts">
  import { Button, Card, CardContent, CardHeader, CardTitle, TextField } from '@salt/ui-components';
  import { auth, devSignIn } from '../lib/auth.svelte.js';
  import { useEmulators } from '../lib/firebase.js';

  let email = $state('');
  let busy = $state(false);

  async function onSend() {
    if (!email || busy) return;
    busy = true;
    try {
      await auth.sendLink(email);
    } finally {
      busy = false;
    }
  }

  async function onDev() {
    if (!email || busy) return;
    busy = true;
    try {
      await devSignIn(email);
    } finally {
      busy = false;
    }
  }
</script>

<main class="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Sign in to Salt</CardTitle>
    </CardHeader>
    <CardContent>
      {#if auth.linkSent}
        <p class="text-sm">
          A sign-in link has been sent to <strong>{email}</strong>. Open it on this device to finish
          signing in.
        </p>
      {:else}
        <form
          class="space-y-4"
          onsubmit={(e) => {
            e.preventDefault();
            void onSend();
          }}
        >
          <TextField
            bind:value={email}
            label="Email"
            type="email"
            placeholder="you@example.com"
            required
          />
          {#if auth.error}
            <p class="text-sm text-destructive">{auth.error}</p>
          {/if}
          <div class="flex gap-2">
            <Button type="submit" disabled={!email || busy} loading={busy}>Send magic link</Button>
            {#if useEmulators}
              <Button type="button" variant="outline" disabled={!email || busy} onclick={onDev}>
                Dev sign-in
              </Button>
            {/if}
          </div>
        </form>
      {/if}
    </CardContent>
  </Card>
</main>
