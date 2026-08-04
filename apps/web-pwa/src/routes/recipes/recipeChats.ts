import type { ChatSessionDoc } from '@salt/domain/schemas';

/**
 * Every chat the signed-in user has had about one recipe, newest first.
 *
 * This is a CLIENT-SIDE filter over a store that is already loaded, not a query:
 * `chatSessions` is owner-scoped and the subscription already fetches the whole
 * of the signed-in user's set, so "all chats for this dish" costs nothing — no
 * second listener, no composite index, no schema field (issue #696).
 *
 * Pure and DOM-free, but deliberately app-local rather than in `@salt/domain`:
 * it is a view over what one page happens to have in memory, not a rule about
 * what a chat or a recipe is.
 */
export function chatsForRecipe(
  sessions: readonly ChatSessionDoc[],
  recipeId: string,
): ChatSessionDoc[] {
  return sessions
    .filter((s) => s.recipeId === recipeId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
