<script lang="ts">
  import Router, { router } from 'svelte-spa-router';
  import {
    AppShell,
    Button,
    Toast,
    ToastClose,
    ToastDescription,
    ToastProvider,
    ToastViewport,
  } from '@salt/ui-components';
  import AuthGate from './components/AuthGate.svelte';
  import { auth } from './lib/auth.svelte.js';
  import { navItems } from './lib/nav.js';
  import { routes } from './routes/index.js';
  import { toasts, dismissToast } from './lib/toastStore.js';
  import { initCanonSync } from './lib/canonService.js';
  import SessionOverlay from './lib/dev/SessionOverlay.svelte';

  // Start Firestore subscriptions when authenticated; clean up on sign-out.
  $effect(() => {
    if (!auth.user) return;
    return initCanonSync();
  });
</script>

<AuthGate>
  <ToastProvider>
    <AppShell {navItems} currentPath={router.location} title="Salt">
      {#snippet actions()}
        <span class="hidden text-sm text-muted-foreground sm:inline">{auth.user?.email ?? ''}</span>
        <Button variant="outline" size="sm" onclick={() => void auth.signOut()}>Sign out</Button>
      {/snippet}
      <Router {routes} />
    </AppShell>
    <ToastViewport>
      {#each $toasts as toast (toast.id)}
        <Toast
          defaultOpen={true}
          variant={toast.variant}
          onOpenChange={(open) => {
            if (!open) dismissToast(toast.id);
          }}
        >
          <ToastDescription>{toast.message}</ToastDescription>
          <ToastClose />
        </Toast>
      {/each}
    </ToastViewport>
  </ToastProvider>
</AuthGate>

{#if import.meta.env.DEV}
  <SessionOverlay />
{/if}
