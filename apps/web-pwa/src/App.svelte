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
  import { productForms, initProductFormSync } from './lib/productFormService.js';
  import { initEquipmentSync } from './lib/equipmentService.js';
  import { initShoppingListSync } from './lib/shoppingListService.svelte.js';
  import { members, initMembersSync } from './lib/membersService.js';
  import { initMealPlanSync } from './lib/mealPlanService.js';
  import { initRecipeSync } from './lib/recipeService.js';
  import { initChatSync } from './lib/chatService.js';
  import { initDevSettingsSync } from './lib/devSettingsService.js';
  import { initAppSettingsSync } from './lib/appSettingsService.js';
  import { initWeatherSync } from './lib/weatherService.js';
  import { normaliseMemberEmail } from '@salt/domain';
  import SessionOverlay from './lib/dev/SessionOverlay.svelte';

  // Start Firestore subscriptions when authenticated; clean up on sign-out.
  $effect(() => {
    if (!auth.user) return;
    const unsubCanon = initCanonSync();
    const unsubProductForms = initProductFormSync();
    const unsubEquipment = initEquipmentSync();
    const unsubShopping = initShoppingListSync();
    const unsubMembers = initMembersSync();
    const unsubMealPlan = initMealPlanSync();
    const unsubRecipes = initRecipeSync();
    const unsubChat = initChatSync(auth.user.uid);
    const unsubDevSettings = initDevSettingsSync();
    const unsubAppSettings = initAppSettingsSync();
    const unsubWeather = initWeatherSync();
    return () => {
      unsubCanon();
      unsubProductForms();
      unsubEquipment();
      unsubShopping();
      unsubMembers();
      unsubMealPlan();
      unsubRecipes();
      unsubChat();
      unsubDevSettings();
      unsubAppSettings();
      unsubWeather();
    };
  });

  // Admin-ness drives whether the operator-area nav entry is shown. Cosmetic
  // only — real enforcement is server-side (rules + CF admin re-checks, #155).
  const currentEmail = $derived(normaliseMemberEmail(auth.user?.email ?? ''));
  const isAdmin = $derived($members.some((m) => m.email === currentEmail && m.admin));

  // Canon management now lives behind the operator area (#157), so its
  // needs-approval backlog count rides on the Admin nav entry — visible only to
  // admins, who are the ones who action the review queue. Product-form proposals
  // (issue #500, Phase 3) share the same review affordance, so their pending count
  // sums into the one Admin badge alongside canon's.
  const reviewCount = $derived(
    $canonItems.filter((i) => i.needs_approval).length +
      $productForms.filter((f) => f.needs_approval).length,
  );
  const decoratedNavItems = $derived([
    ...navItems,
    ...(isAdmin ? [reviewCount > 0 ? { ...adminNavItem, badge: reviewCount } : adminNavItem] : []),
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
    <!--
      Lift toasts above the mobile BottomNav so they don't cover it. Mirrors the
      nav reservation used by AppShell's <main> (h-14 = 3.5rem + safe-area).
      lg:bottom-0: the BottomNav is hidden on desktop, so drop back to the edge.
    -->
    <ToastViewport class="bottom-[calc(3.5rem_+_env(safe-area-inset-bottom))] lg:bottom-0">
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
