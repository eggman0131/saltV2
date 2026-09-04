// Whether the recipe page shows its docked chef-chat column (issue #1141). One
// preference, one boolean: "I want the recipe to have the whole view" is a way of
// working, not a property of one dish, so it is deliberately NOT page-local
// `$state` — that would reset on every navigation and make the control annoying
// enough not to use.
//
// NOT persisted (CLAUDE.md Rule 3: no localStorage/sessionStorage/IndexedDB
// outside the three narrow exceptions in auth.svelte.ts and pwa.ts, and a view
// preference is nowhere near that bar). A module-level rune singleton, the same
// shape as kitchenDashboardPrefs.svelte.ts — in-memory only, so it resets to
// chat-on on reload or in a fresh tab, but survives moving between recipes within
// one session. Nor is it a per-user Firestore document: the data model names four
// per-user collections and says there is no fifth.
//
// It says nothing about whether there is ROOM for the column — that is
// `SPLIT_QUERY` in mediaQuery.svelte.ts, and the page's `chatPaneShown` is the
// conjunction of the two. Below the seam this value is not read at all.

class RecipeChatPanePrefs {
  /** Chat-on is the default, so the page opens exactly as it always has. */
  on = $state(true);

  toggle(): void {
    this.on = !this.on;
  }

  /**
   * Bring the pane back. Called wherever selecting a conversation would otherwise
   * be a dead press — the chat list at the foot of the recipe, "Chat" in the
   * header and in the ⋮ menu.
   */
  show(): void {
    this.on = true;
  }
}

export const recipeChatPanePrefs = new RecipeChatPanePrefs();
