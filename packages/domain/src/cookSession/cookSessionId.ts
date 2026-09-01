// Cook-session identity (issue #1145, carved out of #938's A2-011). One document
// per user per recipe at `cookSessions/{recipeId}_{uid}` — a DETERMINISTIC id so
// reopening the same recipe on another device resumes the same session instead
// of starting a new one (see schemas/cookSession.ts for the full doc contract).
//
// COLLISION SAFETY. The separator cannot occur inside the ids it joins: a recipe
// id is a UUID (hex and hyphens, no underscore) and a uid is alphanumeric, so the
// underscore is unambiguous either side.
const SEPARATOR = '_';

/** The `cookSessions` document id for `uid`'s cook of `recipeId`. */
export function cookSessionId(recipeId: string, uid: string): string {
  return `${recipeId}${SEPARATOR}${uid}`;
}
