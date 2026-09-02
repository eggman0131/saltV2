// The one-coherent-operation-per-step policy, stated once (issue #934).
//
// WHY IT LIVES IN @salt/domain AND NOT BESIDE EITHER PROMPT. Two prompts state
// this policy: `STEP_RULES` in `apps/cloud-functions/src/flows/stepRules.ts`
// (the field-list register, read by the librarian and both extractors) and
// `REFRESH_PROMPT` in `./recipeChatPrompts.js` (the conversational register,
// sent from the recipe page as an ordinary chat turn). CLAUDE.md rule 6 forbids
// `web-pwa` importing `cloud-functions`, so a sentence both must carry has no
// lawful home in either package. `domain` is on the import path of both, and a
// template string is pure — no I/O, no side effects — so rule 1 holds on its
// face. This is the first model-facing prose in the package, which is why it
// sits behind its own `./prompts` subpath rather than the main index: nothing
// importing `@salt/domain` for its schemas pays for it.
//
// THE SHAPE IS COPIED, NOT INVENTED. It is the
// `UK_INGREDIENT_PRINCIPLE` / `INGREDIENT_SUBSTITUTION_RULES` pair in
// `apps/cloud-functions/src/flows/ingredientConversions.ts`: one statement, two
// registers, the heavy form interpolating the light one so the two cannot
// drift. What each consumer supplies for itself is the LABEL and nothing else —
// the field list shouts `ONE COHERENT OPERATION PER STEP.` at it, the chat turn
// says `One coherent operation per step.` — because a shouted header inside a
// second-person paragraph would stilt the chat prompt, and sentence case in a
// field list stops reading as a rule.
//
// Two prompts stating one policy in different words share no substring, so
// nothing greps them and nothing type-checks them. The only thing that can
// catch a second copy reappearing is a test asserting this exact string is
// present in every prompt that must carry it — `stepPolicy.test.ts` here and
// `apps/cloud-functions/tests/flows/stepPolicy.test.ts`.

/**
 * The substance of the step-splitting rule, without the label its consumers add.
 *
 * Interpolated verbatim into `STEP_RULES` and `REFRESH_PROMPT`. It deliberately
 * carries no leading bullet, no trailing newline and no shouted header, so it
 * reads correctly both mid-paragraph in a chat turn and mid-bullet in a
 * markdown field list.
 */
export const ONE_OPERATION_PER_STEP_PRINCIPLE =
  'A step is one thing the cook does before looking back at the recipe. Actions that happen in a single go stay together ("add the garlic and fry until fragrant"); a change of station, a wait, or a distinct process starts a new step. Split any instruction that bundles several operations into consecutive steps.';
