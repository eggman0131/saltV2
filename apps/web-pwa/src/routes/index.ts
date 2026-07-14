import type { Component } from 'svelte';
import type { RouteDefinition, WrappedComponent } from 'svelte-spa-router';
import EquipmentListPage from './equipment/EquipmentListPage.svelte';
import EquipmentCapturePage from './equipment/EquipmentCapturePage.svelte';
import EquipmentEditPage from './equipment/EquipmentEditPage.svelte';
import ShoppingListRedirectPage from './shopping/ShoppingListRedirectPage.svelte';
import ShoppingListCreatePage from './shopping/ShoppingListCreatePage.svelte';
import ShoppingListsManagePage from './shopping/ShoppingListsManagePage.svelte';
import ShoppingListPage from './shopping/ShoppingListPage.svelte';
import MealPlanWeekPage from './mealplan/MealPlanWeekPage.svelte';
import SettingsPage from './settings/SettingsPage.svelte';
import NotFound from './NotFound.svelte';
import { lazy } from './lazyRoute';

// Lazily code-split routes (issue #411). Each `import()` becomes its own chunk,
// kept out of the boot bundle: the admin area drags in Leaflet (the map picker
// in AppSettings → HomeLocationField → LocationMapField), and chat + recipes are
// large, module-specific screens ~most sessions never open. Deferring them
// shrinks first load and lets a deploy that touches only one area re-download
// just that chunk. The core daily-use views (shopping, equipment, meal plan,
// settings) stay eagerly imported so the default route paints immediately.
//
// `lazy` (./lazyRoute) shows a dependency-free RouteLoading placeholder while a
// chunk fetches, and — when a chunk STILL fails after Phase 1's one silent
// auto-reload — an inline "couldn't load this page — retry" fallback instead of
// hanging on the loader (issue #472, Phase 2).

// More-specific static routes must precede parameterised ones when using a Map.
// The Map is typed with RouteDefinition's own value type: without it, `new Map`
// infers a heterogeneous union of `Component<Props>` tuples that TS cannot unify
// to a single readonly entry type under exactOptionalPropertyTypes (the pages
// have differing `params` props), so the constructor overload fails to match.
export const routes: RouteDefinition = new Map<
  string | RegExp,
  Component<any, any> | WrappedComponent
>([
  // Shopping is the default view; '/' redirects to the user's shopping list.
  ['/', ShoppingListRedirectPage],
  ['/equipment', EquipmentListPage],
  ['/equipment/new', EquipmentCapturePage],
  ['/equipment/:id', EquipmentEditPage],
  ['/shopping', ShoppingListRedirectPage],
  ['/shopping/new', ShoppingListCreatePage],
  ['/shopping/lists', ShoppingListsManagePage],
  ['/shopping/:listId', ShoppingListPage],
  ['/mealplan', MealPlanWeekPage],
  // Chat / AI Kitchen Assistant (issue #206). Lazy-loaded (#411).
  ['/chat', lazy(() => import('./chat/ChatListPage.svelte'))],
  ['/chat/:id', lazy(() => import('./chat/ChatSessionPage.svelte'))],
  // Recipe module (issue #179). More-specific static/edit routes precede the
  // parameterised view route. Lazy-loaded (#411).
  ['/recipes', lazy(() => import('./recipes/RecipeListPage.svelte'))],
  ['/recipes/new', lazy(() => import('./recipes/RecipeEditPage.svelte'))],
  ['/recipes/:id/edit', lazy(() => import('./recipes/RecipeEditPage.svelte'))],
  ['/recipes/:id', lazy(() => import('./recipes/RecipeViewPage.svelte'))],
  ['/settings', SettingsPage],
  // Operator area (issues #155, #157). All routes are guarded client-side by
  // AdminGuard; the real boundary is server-side (rules + CF admin checks).
  // Canon management lives here (not the user nav) because approving/curating
  // canon records is an operator activity — see #157. Lazy-loaded (#411): the
  // whole admin area (incl. Leaflet, pulled in by the app-settings map picker)
  // is code-split out of the boot path.
  ['/admin', lazy(() => import('./admin/AdminHomePage.svelte'))],
  ['/admin/members', lazy(() => import('./admin/AdminMembersPage.svelte'))],
  ['/admin/mealplan', lazy(() => import('./admin/AdminMealPlanPage.svelte'))],
  ['/admin/dev-settings', lazy(() => import('./admin/DevSettingsPage.svelte'))],
  ['/admin/app-settings', lazy(() => import('./admin/AppSettingsPage.svelte'))],
  ['/admin/aisles', lazy(() => import('./canon/AisleManagementPage.svelte'))],
  ['/admin/canon', lazy(() => import('./canon/CanonListPage.svelte'))],
  ['/admin/canon/new', lazy(() => import('./canon/CanonCreatePage.svelte'))],
  ['/admin/canon/:id', lazy(() => import('./canon/CanonDetailPage.svelte'))],
  ['/admin/product-forms', lazy(() => import('./admin/ProductFormsPage.svelte'))],
  ['/admin/product-forms/new', lazy(() => import('./admin/ProductFormEditPage.svelte'))],
  ['/admin/product-forms/:id', lazy(() => import('./admin/ProductFormEditPage.svelte'))],
  ['*', NotFound],
]);
