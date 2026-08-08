import {
  Blender,
  BookOpen,
  CalendarDays,
  ChefHat,
  Settings,
  Shield,
  ShoppingCart,
  UserRound,
} from '@lucide/svelte';
import type { NavItem } from '@salt/ui-components';
import { pop, push } from 'svelte-spa-router';

// The daily-driver destinations. Kept to FOUR so the mobile BottomNav has room for
// its active-indicator pill; everything else goes in `overflowNavItems`. The
// desktop SideNav shows both lists inline (see AppShell).
//
// The fourth slot is the personal view ("Mine", issue #634), which took the slot
// Chef vacated to the overflow. Its live "what's open now" badge is attached in
// App.svelte, where the stores it counts are subscribed.
//
// "Mine" was shown to admins only until #682, while the view was still deciding
// what it was for. It now answers exactly one question — what of mine is running
// right now, and what needs a look — so it is fit for the whole household and
// the filter is gone. Every member sees four primary tabs.
export const navItems: NavItem[] = [
  { id: 'shopping', label: 'Shop', icon: ShoppingCart, href: '#/shopping' },
  { id: 'mealplan', label: 'Planner', icon: CalendarDays, href: '#/mealplan' },
  { id: 'recipes', label: 'Recipes', icon: BookOpen, href: '#/recipes' },
  { id: 'mine', label: 'Mine', icon: UserRound, href: '#/mine' },
];

// Set-up-and-forget destinations: folded behind the BottomNav's "More" tab on
// mobile. `adminNavItem` is appended here (admins only) in App.svelte.
//
// Chef (the AI Kitchen Assistant, issue #206) sits here rather than in the primary
// four despite not being set-up-and-forget: it is the least-reached-for of the
// daily destinations, and the primary slot it held is wanted by "Mine" (#634).
// Still available to all members — the overflow is a demotion, not a gate.
export const overflowNavItems: NavItem[] = [
  { id: 'chat', label: 'Chef', icon: ChefHat, href: '#/chat' },
  { id: 'equipment', label: 'Equipment', icon: Blender, href: '#/equipment' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '#/settings' },
];

// Operator-area entry (issues #155, #157). Appended to the nav only for admins —
// see App.svelte, which also hangs the canon needs-approval badge here now that
// canon management lives behind the operator area. Cosmetic gating only; the
// real boundary is server-side.
export const adminNavItem: NavItem = {
  id: 'admin',
  label: 'Admin',
  icon: Shield,
  href: '#/admin',
};

// A back button should return you to wherever you came from, not to a section's
// home list. Every page navigates with svelte-spa-router's `push('/fixed/route')`,
// so a hard-coded back destination is wrong the moment you arrive from anywhere
// other than that list (open a recipe from the planner, hit back, land on the
// recipes list). `goBack` uses real browser history instead.
//
// The catch: `pop()` is `window.history.back()`, which on a PWA cold-launch /
// deep-link / shared URL — where the detail page is the FIRST entry in this tab —
// walks the user straight out of the app. So we track our depth in the in-app
// history stack: svelte-spa-router navigates by setting `window.location.hash`,
// which creates a fresh history entry (its own state carries only scroll data, no
// marker of ours). On every `hashchange` we stamp the current entry with a
// monotonic `__saltIdx` if it has none; a back/forward navigation restores an
// already-stamped entry and is left untouched. The router preserves our marker
// because it always spreads `...history.state` when it writes scroll state, and
// `replace()` reuses the same (already-stamped) entry. `goBack` then reads the
// current entry's index: index 0 (or an unstamped entry) means nothing in-app is
// behind us, so it falls back to the caller's route instead of popping out.
let saltIdxCounter = -1;

function stampCurrentEntry(): void {
  const state = (window.history.state ?? {}) as { __saltIdx?: number };
  if (state.__saltIdx == null) {
    saltIdxCounter += 1;
    window.history.replaceState({ ...state, __saltIdx: saltIdxCounter }, '');
  }
}

if (typeof window !== 'undefined') {
  stampCurrentEntry(); // the initial landing entry becomes index 0
  window.addEventListener('hashchange', stampCurrentEntry);
}

/**
 * Return to the previous in-app screen. Falls back to `fallback` when the current
 * screen is the first in-app history entry (cold-launch / deep-link / shared URL),
 * so a back press never ejects the user out of the app.
 */
export function goBack(fallback: string): void {
  const idx = (window.history.state as { __saltIdx?: number } | null)?.__saltIdx ?? 0;
  if (idx > 0) pop();
  else push(fallback);
}
