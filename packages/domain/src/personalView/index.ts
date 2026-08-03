// Personal-view module (issues #634, #682) — the policy behind "Mine", the
// per-user view over family-shared data. This file is the ONLY thing other domain
// modules and adapters import from personalView; anything not re-exported here is
// private.
//
// Everything in here is a PROJECTION: a pure function from documents that already
// exist to what one member should be shown. There is no per-user storage behind it
// — no inbox, no read state, no `lastSeenAt` — so every card appears when it is
// true and disappears when it is resolved.
//
// Once four helpers, now one. #682 cut /mine back to "what of mine is running
// right now, and what needs a look": the planner projections (`chefDaysForMember`,
// `unshoppedPlannedRecipes`) and the queue ranking (`rankPersonalCards`) went with
// the sections that were restating the planner and the shopping list.
export { needsReview } from './needsReview.js';
