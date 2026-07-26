<script lang="ts">
  import { Button, Card, CardContent, CardHeader, CardTitle, TextField } from '@salt/ui-components';
  import { auth, devSignIn } from '../lib/auth.svelte.js';
  import { useEmulators } from '../lib/firebase.js';
  import { install } from '../lib/install.svelte.js';
  import AddToHomeScreen from './AddToHomeScreen.svelte';

  // Seeded from the store so a restored code-entry step (the app was killed
  // while the user fetched the code — see auth.svelte.ts) knows which address
  // the code went to. Empty for a normal cold start.
  let email = $state(auth.codeEmail);
  let code = $state('');
  let busy = $state(false);

  // Standalone-aware default (issue #546): an installed standalone app (iOS)
  // can't complete a magic link — Safari opens it in a separate storage
  // partition — so lead with the in-app code path there. Everywhere else magic
  // link stays the default and the code path is an available alternative.
  let method = $state<'link' | 'code'>(install.isStandalone ? 'code' : 'link');

  async function onSend() {
    if (!email || busy) return;
    busy = true;
    try {
      await auth.sendLink(email);
    } finally {
      busy = false;
    }
  }

  async function onComplete() {
    if (!email || busy) return;
    busy = true;
    try {
      await auth.completeWithEmail(email);
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

  async function onRequestCode() {
    if (!email || busy) return;
    busy = true;
    try {
      await auth.requestCode(email);
    } finally {
      busy = false;
    }
  }

  async function onSubmitCode() {
    if (code.length !== 6 || busy) return;
    busy = true;
    try {
      await auth.submitCode(email, code);
    } finally {
      busy = false;
    }
  }

  // The chooser's primary button dispatches by method.
  function onPrimarySubmit(e: SubmitEvent) {
    e.preventDefault();
    if (method === 'code') void onRequestCode();
    else void onSend();
  }

  function changeEmail() {
    code = '';
    auth.resetCode();
  }
</script>

<main class="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
  <div class="w-full max-w-md space-y-4">
    <Card class="w-full">
      <CardHeader>
        <CardTitle>Sign in to Salt</CardTitle>
      </CardHeader>
      <CardContent>
        {#if auth.linkSent}
          <p class="text-sm">
            A sign-in link has been sent to <strong>{email}</strong>. Open it on this device to
            finish signing in.
          </p>
        {:else if auth.needsEmail}
          <form
            class="space-y-4"
            onsubmit={(e) => {
              e.preventDefault();
              void onComplete();
            }}
          >
            <p class="text-sm text-muted-foreground">
              Confirm the email you requested the sign-in link for to finish signing in.
            </p>
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
            <Button type="submit" disabled={!email || busy} loading={busy}>Complete sign-in</Button>
          </form>
        {:else if auth.codeSent}
          <!-- Code-entry step: OTP has been emailed, finish in-app. -->
          <form
            class="space-y-4"
            onsubmit={(e) => {
              e.preventDefault();
              void onSubmitCode();
            }}
          >
            <p class="text-sm text-muted-foreground">
              Enter the 6-digit code we emailed to <strong>{email}</strong>.
            </p>
            <TextField
              bind:value={code}
              label="6-digit code"
              placeholder="123456"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength={6}
              required
              data-testid="login-code-input"
            />
            {#if auth.error}
              <p class="text-sm text-destructive">{auth.error}</p>
            {/if}
            <Button
              type="submit"
              disabled={code.length !== 6 || busy}
              loading={busy}
              data-testid="login-verify-code"
            >
              Verify &amp; sign in
            </Button>
            <div class="flex gap-4 text-sm">
              <button
                type="button"
                class="text-muted-foreground underline"
                disabled={busy}
                onclick={onRequestCode}
                data-testid="login-resend-code"
              >
                Resend code
              </button>
              <button
                type="button"
                class="text-muted-foreground underline"
                onclick={changeEmail}
                data-testid="login-change-email"
              >
                Use a different email
              </button>
            </div>
          </form>
        {:else}
          <form class="space-y-4" onsubmit={onPrimarySubmit}>
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
            {#if method === 'code'}
              <Button
                type="submit"
                disabled={!email || busy}
                loading={busy}
                data-testid="login-request-code"
              >
                Email me a 6-digit code
              </Button>
              <button
                type="button"
                class="block text-sm text-muted-foreground underline"
                onclick={() => (method = 'link')}
                data-testid="login-switch-to-link"
              >
                Prefer a magic link instead?
              </button>
            {:else}
              <div class="flex gap-2">
                <Button type="submit" disabled={!email || busy} loading={busy}>
                  Send magic link
                </Button>
                {#if useEmulators}
                  <Button type="button" variant="outline" disabled={!email || busy} onclick={onDev}>
                    Dev sign-in
                  </Button>
                {/if}
              </div>
              <button
                type="button"
                class="block text-sm text-muted-foreground underline"
                onclick={() => (method = 'code')}
                data-testid="login-switch-to-code"
              >
                Email me a 6-digit code instead
              </button>
            {/if}
          </form>
        {/if}
      </CardContent>
    </Card>
    <AddToHomeScreen />
  </div>
</main>
