// Personal-view module (issue #634) — the policy behind "Mine", the per-user view
// over family-shared data. This file is the ONLY thing other domain modules and
// adapters import from personalView; anything not re-exported here is private.
//
// Everything in here is a PROJECTION: a pure function from documents that already
// exist to what one member should be shown. There is no per-user storage behind it
// — no inbox, no read state, no `lastSeenAt` — so every card appears when it is
// true and disappears when it is resolved. That is also why no clock lives here
// (CLAUDE.md Rule 1): "today", "now", and "is the shop imminent" are all injected.
export { chefDaysForMember } from './chefDaysForMember.js';
export { unshoppedPlannedRecipes } from './unshoppedPlannedRecipes.js';
export type { UnshoppedPlannedRecipe } from './unshoppedPlannedRecipes.js';
export { isUnopenedImport, UNOPENED_IMPORT_WINDOW_MS } from './isUnopenedImport.js';
export { rankPersonalCards, PERSONAL_CARD_LIMIT } from './rankPersonalCards.js';
export type { PersonalCardKind, RankableCard } from './rankPersonalCards.js';
