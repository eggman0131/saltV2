import type { Recipe } from '../recipe/index.js';
import type { GuidedStepNoteDoc } from '../schemas/index.js';

// WHAT IS COMING, asked from the step you are on (issue #769).
//
// Plain cook mode ends a step with the top of the next one fading out below it —
// the only preview available when there is nothing but the recipe. A guided plan
// can do better: the plan's author writes one line saying what the next step does,
// and — the part that actually earns the space — whichever bit of it has to START
// NOW. An oven that takes fifteen minutes to come up is a step-N+1 instruction
// that has to happen during step N, and a fading first clause will never say so.
//
// THE NEXT STEP IN THE METHOD, not the next INCOMPLETE one. This answers "what is
// below me", and what is below the step on screen is the step after it in the
// recipe — ticking things off in an odd order moves the cook, not the method.
//
// Returns null for every way there is nothing to preview — no current step, a
// current step the recipe no longer has, the last step, and a next step the plan
// says nothing about (see `said` at the bottom for what "nothing" covers) — so the
// caller's fallback to the plain fade is one branch. That last case is the common
// one for now: every plan written before these fields existed reads as null, and
// looks exactly as it did.

export interface NextStepLookahead {
  readonly stepId: string;
  /** 1-based position in the method — the number the cook sees on the step. */
  readonly number: number;
  /** One line on what that step does. Null when only `getAhead` was authored. */
  readonly lookahead: string | null;
  /** The part of it to start during THIS step. Null on almost every step. */
  readonly getAhead: string | null;
}

export function nextStepLookahead(
  recipe: Recipe,
  notes: readonly GuidedStepNoteDoc[],
  currentStepId: string | null,
): NextStepLookahead | null {
  if (currentStepId === null) return null;
  const at = recipe.steps.findIndex((step) => step.id === currentStepId);
  if (at === -1) return null;
  const next = recipe.steps[at + 1];
  if (next === undefined) return null;
  const note = notes.find((n) => n.stepId === next.id);
  const lookahead = said(note?.lookahead);
  const getAhead = said(note?.getAhead);
  // Either line ALONE is worth the panel: a step whose only note is "start the oven
  // now" is precisely the case this exists for. Neither, and there is no panel —
  // the caller falls back to the plain fade.
  if (lookahead === null && getAhead === null) return null;
  return { stepId: next.id, number: at + 2, lookahead, getAhead };
}

// Whether the plan actually SAID this, as opposed to carrying a field for it.
//
// Blank is not an answer, and neither is absent. A stored note always reads back as
// `string | null` (`.default(null)`), but a note reaching this from anywhere other
// than a schema parse — a hand-edited document, a draft, a fixture — can hold
// `undefined` or an empty string, and an empty look-ahead renders as an empty panel
// covering the next step: strictly worse than the fade it replaced. Cheaper to
// refuse that here, once, than to ask every reader to check for it.
function said(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && value.trim() !== '' ? value : null;
}
