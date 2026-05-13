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
  import { canonItems, initCanonSync } from './lib/canonService.js';
  import { initEquipmentSync } from './lib/equipmentService.js';
  import SessionOverlay from './lib/dev/SessionOverlay.svelte';

  // Start Firestore subscriptions when authenticated; clean up on sign-out.
  $effect(() => {
    if (!auth.user) return;
    const unsubCanon = initCanonSync();
    const unsubEquipment = initEquipmentSync();
    return () => {
      unsubCanon();
      unsubEquipment();
    };
  });

  const needsApprovalCount = $derived($canonItems.filter((i) => i.needs_approval).length);
  const decoratedNavItems = $derived(
    navItems.map((item) =>
      item.id === 'canon' && needsApprovalCount > 0 ? { ...item, badge: needsApprovalCount } : item,
    ),
  );
</script>

<AuthGate>
  <ToastProvider>
    <AppShell navItems={decoratedNavItems} currentPath={router.location} title="Salt">
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
