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

// The daily-driver destinations. Kept to FOUR so the mobile BottomNav has room for
// its active-indicator pill; everything else goes in `overflowNavItems`. The
// desktop SideNav shows both lists inline (see AppShell).
//
// The fourth slot is the personal view ("Mine", issue #634), which took the slot
// Chef vacated to the overflow. Its live "what's open now" badge is attached in
// App.svelte, where the stores it counts are subscribed.
//
// "Mine" is currently shown to admins only — the view needs more design thought
// before it is fit for the whole household, so it is hidden rather than shipped
// half-considered. The filter lives in App.svelte (that is where `isAdmin` is).
// This is cosmetic gating of an unfinished feature, not a permission boundary:
// the `#/mine` route is still reachable by direct URL, and everything it shows
// is family-shared data the member can already see elsewhere. Non-admins simply
// see three primary tabs. Drop the filter to re-open it to everyone.
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
