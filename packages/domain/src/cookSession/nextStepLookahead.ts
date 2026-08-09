import type { Recipe } from '../recipe/index.js';
import type { GuidedStepNoteDoc } from '../schemas/index.js';

// WHAT IS COMING, asked from the step you are on (issue #769).
//
// Plain cook mode ends a step with the top of the next one fading out below it —
// the only preview available when there is nothing but the recipe. A guided plan
// can do better: it says in one line what the next step does, and — the part that
// actually earns the space — what has to be STARTED NOW to be ready in time.
//
// THE NOTE ON THE STEP YOU ARE ON, describing what comes after it. Read that
// sentence twice, because the first shipping of this read the NEXT step's note
// instead and put a correct number against the wrong text: on step 4 the cook was
// told "Next · 5" over a description of step 6, consistently, all the way down a
// recipe. The two halves of the panel came from different steps.
//
// Attaching a look-ahead to the step it is READ FROM rather than the step it
// DESCRIBES is the model's own reading, and it is the better one:
//
//   - `getAhead` is about the SPARE TIME IN THIS STEP, not about the next step's
//     needs. "Preheat the oven" belongs on the ten-minute sauté at step 1, not on
//     the preheat step itself — and the thing it gets ahead of can be several
//     steps away. The other arrangement could only ever look one step forward,
//     which for an oven is already too late.
//   - It is what a field called `lookahead`, written on a step, plainly means. The
//     prompt fought that reading and lost; every plan in Firestore is authored
//     this way.
//   - The reader needs no arithmetic at all: the note you want is the note of the
//     step on screen.
//
// So this is a READER change, not a data one — every plan already written comes
// right without being re-run.
//
// THE NEXT STEP IN THE METHOD, not the next INCOMPLETE one. This answers "what is
// below me", and what is below the step on screen is the step after it in the
// recipe — ticking things off in an odd order moves the cook, not the method.
//
// Returns null for every way there is nothing to preview — no current step, a
// current step the recipe no longer has, the last step, and a step whose note says
// nothing (see `said` at the bottom for what "nothing" covers) — so the caller's
// fallback to the plain fade is one branch. The last-step case matters more than
// it looks: a model asked for a look-ahead on every step will write one there too
// ("everything is ready"), and there is no step for it to be about.

export interface NextStepLookahead {
  /** The step being PREVIEWED — the one after the cook's. */
  readonly stepId: string;
  /** Its 1-based position in the method — the number the cook sees. */
  readonly number: number;
  /** One line on what that step does. Null when only `getAhead` was authored. */
  readonly lookahead: string | null;
  /** What to start during the CURRENT step. Null on almost every step. */
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
  // The CURRENT step's note — the one the cook is standing on. `next` is here only
  // to say whether there is anything left to preview, and to number it.
  const note = notes.find((n) => n.stepId === currentStepId);
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
