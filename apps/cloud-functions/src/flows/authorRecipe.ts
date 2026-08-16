import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { AuthorRecipeInputSchema, LibrarianOutputSchema, RecipeSchema } from '@salt/domain/schemas';
import type { RecipeDoc } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { assembleRecipeDraft } from './assembleRecipeDraft.js';
import { flowModel } from '../ai/fakeModel.js';
import { recipeFieldRules, type MeasurePolicy } from './recipeFieldRules.js';
import { readEquipmentContext, equipmentSectionForLibrarian } from './equipmentContext.js';
import { readComponentContext, componentSectionForLibrarian } from './componentContext.js';

const OutputSchema = z.custom<RecipeDoc>();

export const authorRecipeFlow = ai.defineFlow(
  {
    name: 'authorRecipe',
    inputSchema: AuthorRecipeInputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => {
    const conversationText = input.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Chef'}: ${m.text}`)
      .join('\n\n');

    const tagVocab =
      input.existingTags.length > 0
        ? `\n\nExisting category tags in this recipe collection (prefer these where they genuinely fit; add a new tag only if meaningfully different, and still never an ingredient): ${input.existingTags.join(', ')}.`
        : '';

    // Edit mode: ground the librarian on the existing recipe so it returns the
    // FULL recipe with the conversation's changes applied, rather than authoring
    // a near-empty recipe from an incremental edit chat (e.g. "add some cheese").
    // We keep the structured doc (not just the prompt text) so the draft
    // assembler can diff against it and skip re-parsing/re-embedding unchanged
    // ingredients.
    // The equipment manifest rides along in BOTH create and edit mode, purely so
    // the librarian RECOGNISES appliance names in the transcript and preserves
    // them (see equipmentContext.ts — it must never pick equipment itself).
    // Without it, "sear it in the Pizzaiolo at 400 °C" gets flattened back to
    // "bake in the oven" on the way into the saved recipe.
    //
    // Variation mode (issue #763) is a THIRD composition and deliberately not a
    // shade of edit mode: the conversation is about a new dish that starts from
    // an existing one. It grounds the PROSE on the base recipe — so the draft
    // carries forward every ingredient, step and timing the chat never mentioned
    // — while `assembleRecipeDraft` is still called with `baseRecipe: null`, so
    // the draft never inherits the base's identity (its `producesCanonId`, its
    // image, or its title). Edit mode wins when both ids are set.
    const db = getFirestore();
    const [baseRecipe, variationBase, equipmentContext] = await Promise.all([
      input.recipeId ? readBaseRecipe(db, input.recipeId) : Promise.resolve(null),
      !input.recipeId && input.basedOnRecipeId
        ? readBaseRecipe(db, input.basedOnRecipeId)
        : Promise.resolve(null),
      readEquipmentContext(db, 'authorRecipe'),
    ]);
    // Refresh mode (issue #784) is the one mode that cannot be inferred: it
    // carries `recipeId` exactly as edit mode does, so it arrives on an explicit
    // flag and is tested FIRST — an inferred edit would otherwise swallow it.
    //
    // A refresh whose recipe could not be read is refused rather than degraded.
    // Every other mode falls back to create, which is harmless when a
    // conversation is driving; here it would hand an EMPTY transcript to the
    // create closing and return whatever a model invents from nothing — which
    // the review gate would then offer as a proposal to overwrite the real dish.
    // Failing loudly is the only safe direction.
    const refreshing = input.refresh === true;
    if (refreshing && !baseRecipe) {
      throw new Error(`Cannot refresh recipe ${input.recipeId ?? '(none)'}: recipe not found`);
    }

    // The dishes a meal is built from (issue #838). NAMES, DESCRIPTIONS AND TIMES
    // ONLY — never a component's ingredients or steps, because this flow returns a
    // complete RecipeDoc that is spread over the stored recipe and the planner
    // attaches the meal AND its dishes, so a copied ingredient line is shopped
    // twice for one dinner. See componentContext.ts for the full argument.
    //
    // Necessarily after the reads above: the component ids live inside the recipe
    // document. One batched getAll, and only for a meal — a recipe with no
    // components yields '' and the prompt is byte-for-byte what it was.
    const componentBase = baseRecipe ?? variationBase;
    const componentSection = componentBase
      ? componentSectionForLibrarian(await readComponentContext(db, componentBase, 'authorRecipe'))
      : '';

    const closing =
      refreshing && baseRecipe
        ? refreshModeSection(withComponents(formatRecipeForPrompt(baseRecipe), componentSection))
        : baseRecipe
          ? editModeSection(withComponents(formatRecipeForPrompt(baseRecipe), componentSection))
          : variationBase
            ? variationModeSection(
                withComponents(formatRecipeForPrompt(variationBase), componentSection),
              )
            : CREATE_MODE_CLOSING;
    // The equipment manifest is deliberately absent from a refresh — its framing
    // is written around what "the conversation established", and there is no
    // conversation. See refreshModeSection.
    const equipmentSection = refreshing ? '' : equipmentSectionForLibrarian(equipmentContext);
    const systemPrompt = `${librarianSystem(refreshing ? 'document' : 'conversation')}\n\n${closing}${tagVocab}${
      equipmentSection ? `\n\n${equipmentSection}` : ''
    }`;

    // Flash + temperature:0 for the librarian — accuracy over creativity (issue #206).
    // `flowModel` rather than `resolveModel` so the librarian can be stubbed under
    // FUNCTIONS_AI_FAKE (issue #763): "Save as recipe" had no e2e coverage at all
    // because the one flow it runs was the last leg still reaching a live model.
    // Byte-for-byte the production path when the flag is off — see fakeModel.ts,
    // which already names authorRecipe as a structured-output flow.
    const model = await flowModel('fast', 'authorRecipe');
    const result = await withAiTimeout(
      'authorRecipe',
      () =>
        ai.generate({
          model,
          system: systemPrompt,
          // A refresh has no conversation, so `conversationText` is empty — and a
          // generate call whose user content is empty is rejected outright by
          // Gemini (400 INVALID_ARGUMENT, "contents is not specified"), which is
          // what made every staging refresh fail with no proposal at all. The
          // system prompt is not contents. So refresh supplies the one user turn
          // it does have: the instruction to do the thing. It deliberately says
          // nothing the closing above does not already say — refresh behaviour is
          // specified in `refreshModeSection` and must not acquire a second home.
          prompt: refreshing ? REFRESH_USER_TURN : conversationText,
          output: { schema: LibrarianOutputSchema },
          config: { temperature: 0 },
        }),
      { timeoutMs: 55_000, retries: 0 },
    );

    const parsed = LibrarianOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`Librarian returned invalid recipe structure: ${parsed.error.message}`);
    }

    // Human-readable top-level span name for the end-to-end trace view. The flow
    // span is the active span inside an ai.defineFlow body; setActiveSpanName
    // renames it (caps at 80 chars, no-op when no span is active). Recipe title is
    // only known after the librarian generates, so name it here.
    setActiveSpanName(`Author recipe: ${parsed.data.title}`);

    // `baseRecipe` is null in BOTH create and variation mode — that is what makes
    // a variation an independent dish rather than a second copy of the original.
    // Do not pass `variationBase` here (issue #763).
    return assembleRecipeDraft(parsed.data, { source: { type: 'manual' }, baseRecipe });
  },
);

// The librarian is normally a CONVERSATION source: the chef just said "a
// teaspoon of cumin", and metricating that to 5g inside the same turn makes the
// saved recipe stop matching the words the user is looking at. Hence
// `measures: 'preserve'` for create, edit and variation — the one axis on which
// this prompt differs from the two import prompts, which ask the SAME module for
// `'metricate'` (issue #785). Everything else — tags, step policy, ingredient
// hygiene, British names and spelling — is shared, so a rule improved for one
// authoring path reaches all three.
//
// REFRESH (issue #784) is the exception, and it is why this is a function rather
// than the constant it used to be. A refresh has no conversation: its source is
// a finished recipe DOCUMENT, which is structurally the import case, so it asks
// for `'metricate'` — the clause that lets it fix a stray ounces measure and,
// more importantly, stops it DE-metricating a URL-imported recipe the extraction
// prompt had already converted. Parameterising is the point: appending an
// "ignore the clause above" exception in refresh mode would leave every future
// rule free to drift the same way, which is exactly what #785 existed to end.
// The two are ONE parameter deliberately. Which measure policy applies is not a
// free choice per mode — it follows from what the librarian is reading, and the
// pairing is the whole argument #785 settled. Passing them separately would let
// a fifth mode ask for a document source that preserves the chef's cups, which
// is the drift this replaced.
function librarianSystem(source: 'conversation' | 'document'): string {
  const measures: MeasurePolicy = source === 'document' ? 'metricate' : 'preserve';
  const framing =
    source === 'document'
      ? `You are a precise recipe transcriber. Given a recipe that already exists, \
re-transcribe it under the rules below. There is no conversation to read: the recipe shown to \
you is the entire source.`
      : `You are a precise recipe extraction assistant. \
Given a cooking conversation between a user and a chef, extract and structure a complete recipe.`;

  return `${framing}

${recipeFieldRules({ measures })}`;
}

// Create mode: the conversation is the only source of truth.
const CREATE_MODE_CLOSING = `Extract only what is present in the conversation. \
Do not invent ingredients or steps not discussed — though splitting an operation the chef DID \
describe across consecutive steps, per the one-operation rule above, invents nothing.`;

// Edit mode: the existing recipe is the source of truth and the conversation
// describes a delta to apply. Without this, the librarian (told to "extract only
// what is present in the conversation") drops everything not mentioned in the
// edit chat — saving a recipe that is just the change.
function editModeSection(baseRecipe: string): string {
  return `## Editing an existing recipe
The user is refining a recipe that ALREADY EXISTS. Its current full content is below, \
and the conversation describes the change(s) they want to make to it.

Return the COMPLETE updated recipe: start from the current recipe and apply ONLY the \
changes discussed in the conversation. Preserve every ingredient, step, time, serving \
count, tag, and detail the conversation does not change — keep the original wording \
(rawText) of unchanged ingredients verbatim. Do not drop anything that was not discussed. \
Integrate additions (e.g. a new ingredient) into the appropriate group and reference them \
from the relevant steps.

### Current recipe
${baseRecipe}`;
}

// Variation mode (issue #763): the conversation is about a NEW dish that starts
// from an existing one. It sits between the other two closings and needs both
// halves of them — carry the base forward like edit mode, because a chat that
// only says "prawns instead of chorizo" would otherwise author a recipe made of
// prawns and nothing else; but author it as a new dish like create mode, with
// its own name, rather than returning the original under the original's title.
function variationModeSection(baseRecipe: string): string {
  return `## Writing a variation on an existing recipe
The user is creating a NEW recipe that starts from the one below. The original will NOT be \
changed and must not be described as changed. The conversation says how the new dish differs \
from it.

Build the new recipe on the original: start from its full content and apply the changes \
discussed in the conversation, along with everything those changes imply — an ingredient that \
replaces another usually brings its own quantities, its own place in the method and its own \
timings with it. Keep every ingredient, step, time, serving count and detail the conversation \
does not change, keeping the original wording (rawText) of unchanged ingredients verbatim. Do \
not drop anything that was not discussed.

Give it a title of its own that says what the dish actually IS now. Do NOT reuse the original's \
title, and do not append the word "variation" — a prawn version of a chorizo pilaf is a prawn \
pilaf, not "Chorizo Pilaf variation". Write the description for the new dish too.

### The recipe it starts from
${baseRecipe}`;
}

// Refresh mode (issue #784): re-run the house writing rules over a recipe that
// already exists, with no conversation at all. The other three closings all
// answer "what did the user just ask for"; this one answers "how would we write
// this down today", which is why it is a fourth section rather than a shade of
// edit mode — edit is instructed to change ONLY what was discussed, the exact
// opposite of re-applying every rule to the whole document.
//
// The prompt is the deliverable here. Three things it has to get right, and the
// feature is a bug in every case it does not:
//
//   1. FORBID RE-INVENTION. Everything above this section is a writing rule, and
//      a model handed a recipe and a page of rules will happily "improve" the
//      cooking too. Same dish, same ingredients, same method — only the
//      expression changes. This is the single guardrail that makes Refresh safe
//      to run on a dish you cook and trust.
//   2. CARRY THE USER'S OWN WORDS VERBATIM. `notes` and every `Step.note` are
//      the household's, not the librarian's. `note` survives a round-trip ONLY
//      because the model echoes it back — it is a field on LibrarianStepSchema,
//      not something the assembler restores — so hand-written step notes are
//      silently lost if this does not say so.
//   3. NAME THE HOUSEKEEPING it SHOULD do, so "change nothing" does not win
//      outright and the refresh returns the document untouched.
//
// No equipment section rides with this one, unlike the other three modes. That
// framing is written entirely around what "the conversation established" (see
// equipmentContext.ts) and a refresh has no conversation, so it would be asking
// the model to preserve the equipment specifics of a transcript that does not
// exist. The appliance names are already IN the recipe text, and rule 1 below
// covers them explicitly — which is the protection that actually matters here.
// The user turn for a refresh — see the `prompt` at the generate call for why one
// has to exist at all. Kept beside the section it stands in for so the two are
// read together.
const REFRESH_USER_TURN =
  'Re-transcribe the recipe above under the current rules. Return the complete recipe.';

function refreshModeSection(baseRecipe: string): string {
  return `## Re-transcribing an existing recipe
The recipe below already exists and is being RE-TRANSCRIBED under the current house rules. \
There is no conversation: nobody has asked for a change to this dish. Your job is to write the \
SAME recipe the way the rules above say it should be written.

Return the COMPLETE recipe.

### This is a re-transcription, not a re-invention
The cooking does not change. Specifically, you must NOT:
- substitute, add or remove an ingredient, or change any quantity except to convert its units;
- re-order, merge on grounds of taste, add or remove a cooking action;
- change a temperature, a quantity or a duration except to convert its units;
- generalise or substitute a named piece of equipment — if a step says "Pizzaiolo" it still says \
"Pizzaiolo", never "the oven";
- re-imagine the dish, restyle the voice, or make the writing more appealing.
If you find yourself improving the food, stop: that is a different feature and this is not it.

### What you SHOULD change
Apply every rule above to the whole document, which for an existing recipe usually means:
- converting a measure, a temperature or a spelling the rules now require;
- splitting a step that carries more than one operation, per the step rules;
- lifting quantities out of step text and adding a timer the step describes but does not carry;
- correcting an ingredient name to its British form;
- adding a category tag the recipe has earned.
If a rule already holds, leave that part exactly as it is. Returning the recipe barely changed is \
a perfectly good outcome — an honest "nothing to fix" beats an invented improvement.

### The household's own words are not yours to rewrite
Reproduce the recipe's overall \`notes\` VERBATIM, and reproduce every per-step note (shown as \
"(note: …)" below) VERBATIM on the step it belongs to. These are hand-written by the cook, not \
authored by you, and they are not subject to any rule above — do not restyle, shorten, correct \
or convert them, and do not drop one. If the recipe has no notes, it still has none.

### The recipe to re-transcribe
${baseRecipe}`;
}

// Reads and validates the existing recipe for edit mode. Returns null on a
// missing/corrupt doc or any failure, so edit mode degrades to create mode
// rather than throwing.
async function readBaseRecipe(
  db: ReturnType<typeof getFirestore>,
  recipeId: string,
): Promise<RecipeDoc | null> {
  try {
    const snap = await db.collection('recipes').doc(recipeId).get();
    if (!snap.exists) return null;
    const result = RecipeSchema.safeParse(snap.data());
    if (!result.success) {
      logger.warn('authorRecipe: base recipe failed validation', { recipeId });
      return null;
    }
    return result.data;
  } catch (err) {
    logger.warn('authorRecipe: failed to read base recipe', { recipeId, err });
    return null;
  }
}

// Appends the meal's attached dishes to the rendered recipe, or leaves it exactly
// as it was when there are none (issue #838). One place for the join so all three
// modes put the dishes in the same position — immediately after the recipe they
// hang off, inside the mode's own section rather than adrift at the top level.
function withComponents(recipeText: string, componentSection: string): string {
  return componentSection ? `${recipeText}\n\n${componentSection}` : recipeText;
}

// Renders the existing recipe as plain text for the librarian's system prompt.
// Mirrors chefChat's readRecipeContext but is richer: it includes
// servings/times/tags/notes/timers so the librarian can faithfully reproduce the
// whole recipe, not just title + ingredients + method.
function formatRecipeForPrompt(r: RecipeDoc): string {
  const parts: string[] = [`Title: ${r.title}`];
  if (r.description) parts.push(`Description: ${r.description}`);

  const meta: string[] = [];
  if (r.metadata.servings != null) meta.push(`servings: ${r.metadata.servings}`);
  if (r.metadata.prepTimeMinutes != null) meta.push(`prep: ${r.metadata.prepTimeMinutes} min`);
  if (r.metadata.cookTimeMinutes != null) meta.push(`cook: ${r.metadata.cookTimeMinutes} min`);
  if (r.metadata.totalTimeMinutes != null) meta.push(`total: ${r.metadata.totalTimeMinutes} min`);
  if (meta.length > 0) parts.push(meta.join(', '));
  if (r.metadata.tags.length > 0) parts.push(`Tags: ${r.metadata.tags.join(', ')}`);

  const ingredientLines: string[] = [];
  for (const group of r.ingredients) {
    if (group.name) ingredientLines.push(`${group.name}:`);
    for (const ing of group.items) {
      ingredientLines.push(`  - ${ing.rawText}${ing.isOptional ? ' (optional)' : ''}`);
    }
  }
  if (ingredientLines.length > 0) parts.push(`Ingredients:\n${ingredientLines.join('\n')}`);

  const stepLines = r.steps.map((s, i) => {
    // Include the timer label so a revise round-trip preserves it: without the
    // label here the librarian never sees it and returns it null, silently
    // wiping a hand-typed or previously-authored label (issue #554).
    const timer = s.timer
      ? ` [timer: ${s.timer.durationMinutes} min${
          s.timer.description ? ` — ${s.timer.description}` : ''
        }]`
      : '';
    const note = s.note ? ` (note: ${s.note})` : '';
    return `  ${i + 1}. ${s.text}${timer}${note}`;
  });
  if (stepLines.length > 0) parts.push(`Method:\n${stepLines.join('\n')}`);

  if (r.notes) parts.push(`Notes: ${r.notes}`);

  return parts.join('\n\n');
}
