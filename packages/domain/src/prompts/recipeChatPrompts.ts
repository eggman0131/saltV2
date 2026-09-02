// The two canned chef-chat turns the recipe page can send on the reader's behalf.
//
// They are PROMPT TEXT, not domain logic, and they are here for one reason
// (issue #934): `REFRESH_PROMPT` states the step policy that
// `apps/cloud-functions/src/flows/stepRules.ts` also states, CLAUDE.md rule 6
// forbids `web-pwa` importing `cloud-functions`, and a policy stated twice in
// different words is invisible to every tool this repo has. Both prompts moved
// out of `apps/web-pwa/src/routes/recipes/RecipeViewPage.svelte` together —
// #934's "Done when" is that no policy prose remains in a Svelte component, and
// moving one of two identically-sent prompts would satisfy the letter of that
// and abandon the point. Only Refresh is deduplicated; Optimise is RELOCATED,
// its content being genuine per-action instruction rather than shared policy.
//
// Nothing about how they are sent changed: both still land in the transcript as
// ordinary USER turns from the recipe page's ⋮ menu.

import { ONE_OPERATION_PER_STEP_PRINCIPLE } from './stepPolicy.js';

// ─── "Optimise for my kitchen" canned prompt ─────────────────────────────────
// A shortcut for a prompt you could type by hand, not a new capability: this
// lands in the transcript as an ordinary USER turn, which is why it is canned
// text rather than anything in a flow prompt file. chefChat already has both
// the household equipment manifest and the current recipe server-side, so the
// text deliberately names no appliance — the manifest is injected for us, and
// hardcoding kit here would go stale the moment the household buys something.
//
// The wording carries four loads: method-only (an ingredient rewrite would put
// every ingredient back through canon matching for nothing), timings and
// temperatures MOVING with the method (a pressure-cooker step that keeps the
// two-hour simmer is worse than no change), proportionality (leaving a step
// alone is a valid and common outcome), and a short account of what changed so
// the chat turn reads on its own before you open the diff.
export const OPTIMISE_FOR_KITCHEN_PROMPT = `Go through this recipe's method and re-work it around the equipment I actually own.

Where a piece of my kit genuinely does a step better, rewrite that step to use it, and be specific: name the appliance, the mode, the accessory and the setting. Move the timings and temperatures with it — a step that changes equipment has to carry the times and temperatures that equipment actually needs, not the ones inherited from the original method. A step handed to different kit but left on the old timings is worse than no change at all.

Change the method only. Leave the ingredients, the quantities and the servings exactly as they are — this is about how it is cooked, not what goes into it.

Be proportionate. Only move a step where the result or the effort is genuinely better for it, counting set-up and washing-up as part of the cost. Leaving a step exactly as written is a good outcome, and if nothing in this recipe is better off on my kit, say so plainly rather than finding something to change.

Finish with a short note on what you changed and why, so I can read the gist here before I look at the recipe itself.`;

// ─── "Refresh" canned prompt (issue #890) ────────────────────────────────────
// Refresh asks the chef to WRITE THE DISH OUT AGAIN — the same dinner, written
// the way it would be written today, for this kitchen. It is the same shape as
// Optimise above and for the same reason: a shortcut for a prompt you could
// type by hand, landing in the transcript as an ordinary user turn.
//
// It replaces a fourth librarian mode (#784), which re-transcribed the document
// at temperature 0 on the `fast` tier under a prompt that forbade re-invention
// and ended by blessing "barely changed" as a good outcome. It did what it said
// and that turned out to be the wrong job: recipes that had lost their servings
// and their timings, or that carried four operations in one step, came back
// unrepaired, because a transcriber may not state a fact the document does not
// already hold. The chef may, and does — it is `pro`, and the equipment
// manifest, the household's favourites and the kitchen notes all ride with it.
//
// The wording carries five loads:
//   1. WRITE THE WHOLE THING OUT. The librarian transcribes the conversation, so
//      a reply that lists changes rather than the recipe leaves it with nothing
//      to transcribe.
//   2. SERVINGS AND TIMINGS ARE THE REPAIR. This is the half that fixes real
//      recipes in the library, and the half no transcriber could ever do.
//   3. THE SAME DISH. The photograph, the shopping history and the household's
//      trust all belong to the dinner they already know.
//   4. INGREDIENTS BY EXCEPTION, OUT LOUD. Every changed line costs a re-parse
//      and a re-canonicalisation, and quantities are what people trust most —
//      so a change has to earn itself and be said plainly, not slipped in.
//   5. THE HOUSEHOLD'S OWN NOTES ARE NOT THE CHEF'S TO REWRITE. Same rule the
//      old refresh prompt carried, and the one thing worth keeping from it.
// Kit is deliberately unmentioned: `equipmentSectionForChef` already tells the
// chef what is owned and — crucially — that proportionality is a rule, so
// naming appliances here would only re-open a question the manifest settles.
//
// Load 1's step paragraph is the ONLY sentence here that is not this prompt's
// own: it interpolates ONE_OPERATION_PER_STEP_PRINCIPLE, the same statement
// STEP_RULES interpolates, so the chat turn and the field list cannot ask for
// different step splitting. Everything either side of it is unchanged from #890.
export const REFRESH_PROMPT = `Write this recipe out again from scratch — the same dish, written the way you would write it today for my kitchen.

Give me the complete recipe, not a list of changes: every ingredient and every step, in full, as though I had just asked you for it.

State the servings, and state the timings. If the recipe has lost them, work them out and put them back — how many it feeds, how long the prep and the cooking take, and how long each step that involves waiting actually takes. A step with a wait needs its own duration.

One coherent operation per step. ${ONE_OPERATION_PER_STEP_PRINCIPLE}

Keep it the same dish. The ingredients and the quantities should come through as they are — change one only where a genuinely better method or a piece of my kit actually requires it, and when you do, say which one you changed and why. Don't take the opportunity to improve the food.

Leave my own notes alone — the recipe's notes and any notes on individual steps are mine, not yours. Reproduce them as they are.

Finish with a short note on what you changed and why, so I can read the gist here before I look at the diff.`;
