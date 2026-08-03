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
  import { navItems, overflowNavItems, adminNavItem } from './lib/nav.js';
  import { routes } from './routes/index.js';
  import { isFullViewportRoute } from './routes/fullViewport.js';
  import { toasts, dismissToast } from './lib/toastStore.js';
  import { canonItems, initCanonSync } from './lib/canonService.js';
  import { productForms, initProductFormSync } from './lib/productFormService.js';
  import { initEquipmentSync } from './lib/equipmentService.js';
  import { initShoppingListSync } from './lib/shoppingListService.svelte.js';
  import { currentMember, initMembersSync } from './lib/membersService.js';
  import { initMealPlanSync } from './lib/mealPlanService.js';
  import { initShoppingDaySync } from './lib/shoppingDayService.js';
  import { initRecipeSync } from './lib/recipeService.js';
  import { initChatSync } from './lib/chatService.js';
  import { initDevSettingsSync } from './lib/devSettingsService.js';
  import { initAppSettingsSync } from './lib/appSettingsService.js';
  import { initWeatherSync } from './lib/weatherService.js';
  import { initCookTimerAlerts } from './lib/cookTimerAlerts.js';
  import { initMyCookSessionsSync } from './lib/cookSessionService.js';
  import { mineOpenCount } from './lib/personalViewService.js';
  import { runPendingShareImport } from './lib/shareTarget.js';
  import { envBanner } from './lib/environment.js';
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
    // Follows the planner's selected week (initMealPlanSync above sets it), so it
    // must start after it.
    const unsubShoppingDay = initShoppingDaySync();
    const unsubRecipes = initRecipeSync();
    const unsubChat = initChatSync(auth.user.uid);
    // My open cook sessions (issue #634). App-wide rather than page-local: the
    // "resume a cook" card and its nav badge have to be answerable from any page.
    const unsubMyCooks = initMyCookSessionsSync(auth.user.uid);
    const unsubDevSettings = initDevSettingsSync();
    const unsubAppSettings = initAppSettingsSync();
    const unsubWeather = initWeatherSync();
    // Not a Firestore subscription — a clock over the cook-session store the cook
    // page already fills. It lives here rather than on the cook page so a timer
    // still alerts once the chef has navigated away (see cookTimerAlerts.ts).
    const unsubCookTimers = initCookTimerAlerts();
    return () => {
      unsubCanon();
      unsubProductForms();
      unsubEquipment();
      unsubShopping();
      unsubMembers();
      unsubMealPlan();
      unsubShoppingDay();
      unsubRecipes();
      unsubChat();
      unsubMyCooks();
      unsubDevSettings();
      unsubAppSettings();
      unsubWeather();
      unsubCookTimers();
    };
  });

  // Web Share Target hand-off (issue #589). main.ts captured the shared link before
  // mount; this runs it once auth has resolved, because the import goes through an
  // authenticated callable. Signed out, it drops the share with a toast rather than
  // resuming after sign-in (Rule 3 — no third browser-storage carve-out). The
  // pending share is single-use, so re-runs of this effect are no-ops.
  $effect(() => {
    if (auth.loading) return;
    void runPendingShareImport(!!auth.user);
  });

  // Admin-ness drives whether the operator-area nav entry is shown. Cosmetic
  // only — real enforcement is server-side (rules + CF admin re-checks, #155).
  // `currentMember` (membersService) is the same uid → email → member resolution
  // this used to do inline; the personal view needs it too, so it lives there now.
  const isAdmin = $derived($currentMember?.admin === true);

  // "Mine" carries a count of what is OPEN right now — my open cooks plus the
  // timers that have fired and nobody has dismissed (issues #634, #682).
  // Deliberately not "changed since you last looked": that needs a per-user
  // lastSeenAt, which means browser storage (Rule 3) or a fourth per-user
  // collection, and it lies across devices. A live count needs no memory,
  // self-clears when you fix the thing, and is honest on a cold launch. The
  // needs-review queue is excluded — it is a standing queue, so counting it would
  // pin a permanent number to the tab. A timer still counting down is excluded
  // too: it is running to plan and wants no hand.
  //
  // Shown to every member since #682 — see lib/nav.ts for what changed.
  const decoratedNavItems = $derived(
    navItems.map((item) =>
      item.id === 'mine' && $mineOpenCount > 0 ? { ...item, badge: $mineOpenCount } : item,
    ),
  );

  // Canon management now lives behind the operator area (#157), so its
  // needs-approval backlog count rides on the Admin nav entry — visible only to
  // admins, who are the ones who action the review queue. Product-form proposals
  // (issue #500, Phase 3) share the same review affordance, so their pending count
  // sums into the one Admin badge alongside canon's.
  const reviewCount = $derived(
    $canonItems.filter((i) => i.needs_approval).length +
      $productForms.filter((f) => f.needs_approval).length,
  );
  // Admin joins the overflow rather than the four primary tabs. The BottomNav sums
  // the overflow badges onto its "More" tab, so the review count still surfaces
  // even while Admin itself is folded away.
  // A full-viewport route (cook mode) replaces the shell's chrome rather than
  // painting over it (issue #641) — covered nav stays focusable and stays in the
  // accessibility tree, so a keyboard user tabs into invisible navigation and can
  // leave mid-cook by accident.
  const showChrome = $derived(!isFullViewportRoute(router.location));

  const decoratedOverflowNavItems = $derived([
    ...overflowNavItems,
    ...(isAdmin ? [reviewCount > 0 ? { ...adminNavItem, badge: reviewCount } : adminNavItem] : []),
  ]);
</script>

<AuthGate>
  <ToastProvider>
    <AppShell
      navItems={decoratedNavItems}
      overflowNavItems={decoratedOverflowNavItems}
      currentPath={router.location}
      chrome={showChrome}
      title="Salt"
      envLabel={envBanner?.label}
      envClass={envBanner?.barClass}
    >
      {#snippet actions()}
        <span class="hidden text-sm text-muted-foreground sm:inline">{auth.user?.email ?? ''}</span>
        <Button variant="outline" size="sm" onclick={() => void auth.signOut()}>Sign out</Button>
      {/snippet}
      <Router {routes} />
    </AppShell>
    <!--
      Lift toasts above the mobile BottomNav so they don't cover it. Mirrors the
      nav reservation used by AppShell's <main> (h-14 = 3.5rem + safe-area).
      lg:bottom-0: the BottomNav is hidden on desktop, so drop back to the edge —
      as does a full-viewport route, which has no BottomNav to clear at any width.
    -->
    <ToastViewport
      class={showChrome ? 'bottom-[calc(3.5rem_+_env(safe-area-inset-bottom))] lg:bottom-0' : ''}
    >
      {#each $toasts as toast (toast.id)}
        <Toast
          defaultOpen={true}
          variant={toast.variant}
          duration={toast.duration}
          showCountdown={!!toast.action}
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
