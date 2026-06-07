<script lang="ts">
  import Router, { router } from 'svelte-spa-router';
  import {
    AppShell,
    Button,
    Toast,
    ToastAction,
    ToastClose,
    ToastDescription,
    ToastProvider,
    ToastViewport,
  } from '@salt/ui-components';
  import AuthGate from './components/AuthGate.svelte';
  import { auth } from './lib/auth.svelte.js';
  import { navItems, adminNavItem } from './lib/nav.js';
  import { routes } from './routes/index.js';
  import { toasts, dismissToast } from './lib/toastStore.js';
  import { canonItems, initCanonSync } from './lib/canonService.js';
  import { initEquipmentSync } from './lib/equipmentService.js';
  import { initShoppingListSync } from './lib/shoppingListService.svelte.js';
  import { members, initMembersSync } from './lib/membersService.js';
  import { normaliseMemberEmail } from '@salt/domain';
  import SessionOverlay from './lib/dev/SessionOverlay.svelte';

  // Start Firestore subscriptions when authenticated; clean up on sign-out.
  $effect(() => {
    if (!auth.user) return;
    const unsubCanon = initCanonSync();
    const unsubEquipment = initEquipmentSync();
    const unsubShopping = initShoppingListSync();
    const unsubMembers = initMembersSync();
    return () => {
      unsubCanon();
      unsubEquipment();
      unsubShopping();
      unsubMembers();
    };
  });

  // Admin-ness drives whether the operator-area nav entry is shown. Cosmetic
  // only — real enforcement is server-side (rules + CF admin re-checks, #155).
  const currentEmail = $derived(normaliseMemberEmail(auth.user?.email ?? ''));
  const isAdmin = $derived($members.some((m) => m.email === currentEmail && m.admin));

  const needsApprovalCount = $derived($canonItems.filter((i) => i.needs_approval).length);
  const decoratedNavItems = $derived([
    ...navItems.map((item) =>
      item.id === 'canon' && needsApprovalCount > 0 ? { ...item, badge: needsApprovalCount } : item,
    ),
    ...(isAdmin ? [adminNavItem] : []),
  ]);
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
          duration={toast.duration}
          onOpenChange={(open) => {
            if (!open) {
              toast.onDismiss?.();
              dismissToast(toast.id);
            }
          }}
        >
          <ToastDescription>{toast.message}</ToastDescription>
          {#if toast.action}
            <ToastAction
              onclick={() => {
                toast.action?.onClick();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </ToastAction>
          {/if}
          <ToastClose />
        </Toast>
      {/each}
    </ToastViewport>
  </ToastProvider>
</AuthGate>

{#if import.meta.env.DEV && !window.__e2e}
  <SessionOverlay />
{/if}
