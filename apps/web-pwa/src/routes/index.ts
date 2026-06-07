import type { RouteDefinition } from 'svelte-spa-router';
import HomePage from './home/HomePage.svelte';
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
import SettingsPage from './settings/SettingsPage.svelte';
import AdminHomePage from './admin/AdminHomePage.svelte';
import AdminMembersPage from './admin/AdminMembersPage.svelte';
import NotFound from './NotFound.svelte';

// More-specific static routes must precede parameterised ones when using a Map.
export const routes: RouteDefinition = new Map([
  ['/', HomePage],
  ['/canon', CanonListPage],
  ['/canon/aisles', AisleManagementPage],
  ['/canon/new', CanonCreatePage],
  ['/canon/:id', CanonDetailPage],
  ['/equipment', EquipmentListPage],
  ['/equipment/new', EquipmentCapturePage],
  ['/equipment/:id', EquipmentEditPage],
  ['/shopping', ShoppingListRedirectPage],
  ['/shopping/new', ShoppingListCreatePage],
  ['/shopping/lists', ShoppingListsManagePage],
  ['/shopping/:listId', ShoppingListPage],
  ['/settings', SettingsPage],
  // Operator area (issue #155). Both routes are guarded client-side by
  // AdminGuard; the real boundary is server-side (rules + CF admin checks).
  ['/admin', AdminHomePage],
  ['/admin/members', AdminMembersPage],
  ['*', NotFound],
]);
