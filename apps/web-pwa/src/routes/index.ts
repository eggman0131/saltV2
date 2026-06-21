import type { RouteDefinition } from 'svelte-spa-router';
import CanonListPage from './canon/CanonListPage.svelte';
import CanonCreatePage from './canon/CanonCreatePage.svelte';
import CanonDetailPage from './canon/CanonDetailPage.svelte';
import AisleManagementPage from './canon/AisleManagementPage.svelte';
import EquipmentListPage from './equipment/EquipmentListPage.svelte';
import EquipmentCapturePage from './equipment/EquipmentCapturePage.svelte';
import EquipmentEditPage from './equipment/EquipmentEditPage.svelte';
import ShoppingListRedirectPage from './shopping/ShoppingListRedirectPage.svelte';
import ShoppingListCreatePage from './shopping/ShoppingListCreatePage.svelte';
import ShoppingListsManagePage from './shopping/ShoppingListsManagePage.svelte';
import ShoppingListPage from './shopping/ShoppingListPage.svelte';
import MealPlanWeekPage from './mealplan/MealPlanWeekPage.svelte';
import ChatListPage from './chat/ChatListPage.svelte';
import ChatSessionPage from './chat/ChatSessionPage.svelte';
import RecipeListPage from './recipes/RecipeListPage.svelte';
import RecipeEditPage from './recipes/RecipeEditPage.svelte';
import RecipeViewPage from './recipes/RecipeViewPage.svelte';
import SettingsPage from './settings/SettingsPage.svelte';
import AdminHomePage from './admin/AdminHomePage.svelte';
import AdminMembersPage from './admin/AdminMembersPage.svelte';
import AdminMealPlanPage from './admin/AdminMealPlanPage.svelte';
import DevSettingsPage from './admin/DevSettingsPage.svelte';
import AppSettingsPage from './admin/AppSettingsPage.svelte';
import NotFound from './NotFound.svelte';

// More-specific static routes must precede parameterised ones when using a Map.
export const routes: RouteDefinition = new Map([
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
  // Chat / AI Kitchen Assistant (issue #206).
  ['/chat', ChatListPage],
  ['/chat/:id', ChatSessionPage],
  // Recipe module (issue #179). More-specific static/edit routes precede the
  // parameterised view route.
  ['/recipes', RecipeListPage],
  ['/recipes/new', RecipeEditPage],
  ['/recipes/:id/edit', RecipeEditPage],
  ['/recipes/:id', RecipeViewPage],
  ['/settings', SettingsPage],
  // Operator area (issues #155, #157). All routes are guarded client-side by
  // AdminGuard; the real boundary is server-side (rules + CF admin checks).
  // Canon management lives here (not the user nav) because approving/curating
  // canon records is an operator activity — see #157.
  ['/admin', AdminHomePage],
  ['/admin/members', AdminMembersPage],
  ['/admin/mealplan', AdminMealPlanPage],
  ['/admin/dev-settings', DevSettingsPage],
  ['/admin/app-settings', AppSettingsPage],
  ['/admin/aisles', AisleManagementPage],
  ['/admin/canon', CanonListPage],
  ['/admin/canon/new', CanonCreatePage],
  ['/admin/canon/:id', CanonDetailPage],
  ['*', NotFound],
]);
