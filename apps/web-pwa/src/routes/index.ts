import type { RouteDefinition } from 'svelte-spa-router';
import HomePage from './home/HomePage.svelte';
import CanonListPage from './canon/CanonListPage.svelte';
import CanonCreatePage from './canon/CanonCreatePage.svelte';
import CanonDetailPage from './canon/CanonDetailPage.svelte';
import SettingsPage from './settings/SettingsPage.svelte';
import NotFound from './NotFound.svelte';

// More-specific static routes (/canon/new) must precede parameterised ones (/canon/:id)
// when using a Map to preserve insertion order.
export const routes: RouteDefinition = new Map([
  ['/', HomePage],
  ['/canon', CanonListPage],
  ['/canon/new', CanonCreatePage],
  ['/canon/:id', CanonDetailPage],
  ['/settings', SettingsPage],
  ['*', NotFound],
]);
