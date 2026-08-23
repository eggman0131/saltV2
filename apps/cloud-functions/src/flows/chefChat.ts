import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { ChefChatInputSchema } from '@salt/domain/schemas';
import { RecipeSchema } from '@salt/domain/schemas';
import { CanonItemSchema, CanonPurchaseCountsSchema } from '@salt/domain/schemas';
import {
  AI_TEXT_FLOW_TIMEOUT,
  withAiStreamTimeout,
  withAiTimeout,
} from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { flowModel } from '../ai/fakeModel.js';
import { reportFlowError } from '../observability/reportServerError.js';
import { UK_INGREDIENT_PRINCIPLE } from './ingredientConversions.js';
import { readEquipmentContext, equipmentSectionForChef } from './equipmentContext.js';
import { readKitchenMemoryContext, kitchenMemorySectionForChef } from './kitchenMemoryContext.js';
import { readComponentContext, componentSectionForChef } from './componentContext.js';
import { formatRecipeForPrompt, withComponents } from './recipeText.js';

async function readRecipeContext(
  db: ReturnType<typeof getFirestore>,
  recipeId: string,
): Promise<string> {
  try {
    const snap = await db.collection('recipes').doc(recipeId).get();
    if (!snap.exists) return '';
    const result = RecipeSchema.safeParse(snap.data());
    if (!result.success) {
      logger.warn('chefChat: recipe failed validation', { recipeId });
      return '';
    }
    const r = result.data;

    // The SAME rendering the librarian reads (issue #890). This used to be a
    // thinner hand-rolled twin — title, description, ingredient lines and step
    // text — which was survivable while the chef only talked ABOUT a dish, and
    // stopped being survivable the moment Refresh asked it to write one out: a
    // chef shown no servings, no times, no step timers and no notes hands the
    // librarian a recipe with those things missing, and the household loses
    // them. See recipeText.ts.
    //
    // The dishes a meal is built from (issue #838) are appended to the recipe
    // body rather than pushed as their own top-level section, so they stay
    // adjacent to the recipe they belong to and nest correctly under whichever
    // heading the caller puts this text under — "Current recipe" or "Starting
    // point for a NEW dish". Both paths reach this reader, so a variation chat
    // sees the dinner too.
    //
    // The read cannot join the flow's Promise.all: the component ids are inside
    // the recipe document, so this is the one round-trip that is necessarily
    // serial. It is a single batched getAll and only happens for a meal — a
    // recipe with no components returns '' here and the prompt is unchanged.
    const componentSection = componentSectionForChef(await readComponentContext(db, r, 'chefChat'));
    return withComponents(formatRecipeForPrompt(r), componentSection);
  } catch (err) {
    logger.warn('chefChat: failed to read recipe', { recipeId, err });
    return '';
  }
}

// ─── Household favourites (issue #726) ───────────────────────────────────────
//
// What the household actually buys, counted from shopping-list tick-offs. Read
// server-side from Firestore via the Admin SDK — Cloud Functions must not import
// `@salt/firebase-sync`, which is browser-only (Rule 2).
//
// PROVISIONAL PARAMETERS. The issue asks for these to be judged against a
// populated `canonData/purchaseCounts` document, which cannot exist until the
// capture side has been live for a few shops. `stocked` was chosen because it
// already separates the pantry from the shop on real canon — it covers salt,
// sugar, flour, the oils, eggs, milk, coffee and the ground spices. Two things
// to revisit once there is data: it also sweeps up household non-food (bleach,
// tissues, washing-up liquid), which is right for the chef but means `stocked`
// is doing double duty; and an `aisleId` exclusion may be the better tool for
// that half. Both constants are safe to retune — nothing depends on their value.
const FAVOURITES_TOP_N = 25;
// How many counted ids to resolve before staples are stripped. Bounded so a long
// history cannot turn one chat message into a full canon scan, and generously
// above TOP_N so stripping the staples still leaves a full list. Only ids the
// household has actually ticked are ever fetched, so early on this is a handful
// of reads, not a collection read.
const FAVOURITES_LOOKUP_LIMIT = 100;

/**
 * Reads the household's most-bought non-staple ingredients as a prompt section.
 *
 * Returns '' whenever there is nothing worth saying — no counts document, an
 * empty one, every counted item a staple, or any failure at all. Taste context
 * is an enhancement and never a hard dependency, so chat behaves exactly as it
 * did before this existed when the signal is absent.
 */
export async function readFavouritesContext(db: ReturnType<typeof getFirestore>): Promise<string> {
  try {
    const snap = await db.collection('canonData').doc('purchaseCounts').get();
    if (!snap.exists) return '';
    const parsed = CanonPurchaseCountsSchema.safeParse(snap.data());
    if (!parsed.success) {
      logger.warn('chefChat: purchaseCounts failed validation, proceeding without taste context');
      return '';
    }

    const ranked = Object.entries(parsed.data.counts)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, FAVOURITES_LOOKUP_LIMIT);
    if (ranked.length === 0) return '';

    // Counts outlive the canon items they key: an id whose item has since been
    // deleted simply resolves to a missing snapshot and drops out here.
    const snaps = await db.getAll(...ranked.map(([id]) => db.collection('canonItems').doc(id)));
    const byId = new Map<string, string>();
    for (const doc of snaps) {
      if (!doc.exists) continue;
      const item = CanonItemSchema.safeParse(doc.data());
      // A list read: skip the invalid doc rather than losing the whole signal.
      if (!item.success) continue;
      if (item.data.shoppingBehavior === 'stocked') continue;
      byId.set(doc.id, item.data.name);
    }

    const names = ranked
      .map(([id]) => byId.get(id))
      .filter((name): name is string => name !== undefined)
      .slice(0, FAVOURITES_TOP_N);
    if (names.length === 0) return '';

    return `${FAVOURITES_FRAMING}\n\n${names.map((n) => `- ${n}`).join('\n')}`;
  } catch (err) {
    logger.warn('chefChat: failed to read purchaseCounts', { err });
    return '';
  }
}

const FAVOURITES_FRAMING = `## What this household actually buys
Below are the ingredients this household buys most often, most-bought first, counted from what \
they tick off at the shop rather than what they put on the list. Pantry staples are deliberately \
excluded — everyone buys flour, milk and black pepper, and they say nothing about what anyone \
enjoys eating. What is left is the taste signal: the cuts of meat, the cheeses, the vegetables \
they actually reach for.

Use it to read what is being asked of you. It is not a shopping list, a restriction, or a set of \
ingredients you must use:

- When they ask for something DIFFERENT, new, or a change from the usual — steer AWAY from this \
list. It IS the usual. Reach for cuisines, proteins and vegetables that are not on it.
- When they ask for something FAMILIAR, easy, or made from what they normally get — lean IN and \
build around these, because they are already in the basket.
- When they ask for neither, which is most of the time, ignore it entirely. Never bend an \
unrelated answer towards or away from this list.

Never mention this list, quote it back, or tell the user what they buy. It is background \
knowledge, not a talking point.`;

// A variation chat is grounded on a recipe it is NOT amending (issue #763). The
// heading has to say so: under the "Current recipe" wording above, the chef
// answers as though the user were editing that dish and starts talking about
// what "we" will change, when the original is about to be left exactly as it is.
const VARIATION_FRAMING = `## Starting point for a NEW dish
The user is not editing the recipe below and it will not be changed. They are using it as the \
starting point for a NEW dish of their own, and want to talk through how to take it somewhere \
else — a different protein, a different cuisine, a different occasion.

Treat it as a well-understood baseline: you know its ingredients, its method and its timings, so \
when they ask for a change, work out everything that has to follow from it. A swapped ingredient \
usually drags more with it than the line it replaces — fat that something else was providing, \
seasoning that has to be rebalanced, a stage that now belongs at a different point in the method. \
Say so, specifically, rather than only answering the question as asked.

Talk about the new dish as a new dish. Never describe the change as an edit to the recipe below, \
and do not tell the user to update or re-save the original.`;

function buildSystemPrompt(
  equipmentContext: string,
  recipeContext: string,
  favouritesContext: string,
  variationContext: string,
  memoryContext: string,
  speaker: string | undefined,
): string {
  const sections: string[] = [CHEF_SYSTEM_BASE];

  const equipmentSection = equipmentSectionForChef(equipmentContext);
  if (equipmentSection) sections.push(equipmentSection);

  if (favouritesContext) sections.push(favouritesContext);

  // AFTER the favourites and BEFORE the dish, deliberately. The two taste signals
  // belong together — one inferred from what gets ticked off at the shop, the other
  // the household's own words — and the explicit one goes second so it reads as the
  // correction to the inferred one rather than the other way round. Both sit ahead
  // of the recipe so the dish under discussion stays the last, most specific thing
  // the chef reads; a preference nearer the end of the prompt than the task is how
  // "never open with them" turns into opening with them.
  //
  // Absent entirely when there are no notes, so a household with none gets exactly
  // today's prompt, byte for byte.
  const memorySection = kitchenMemorySectionForChef(memoryContext, speaker);
  if (memorySection) sections.push(memorySection);

  if (recipeContext) {
    sections.push(
      `## Current recipe\nThe user is asking about this recipe. Use it as context for the conversation.\n\n${recipeContext}`,
    );
  }

  // Mutually exclusive with the section above in practice — a session is either
  // attached to a recipe or based on one, never both — but ordered after it so a
  // session that somehow carried both still reads as an amendment, matching the
  // librarian's precedence.
  if (variationContext) {
    sections.push(`${VARIATION_FRAMING}\n\n${variationContext}`);
  }

  return sections.join('\n\n');
}

export const chefChatFlow = ai.defineFlow(
  {
    name: 'chefChat',
    inputSchema: ChefChatInputSchema,
    outputSchema: z.string(),
    streamSchema: z.string(),
  },
  async (input, streamingCallback) => {
    try {
      const db = getFirestore();
      const [equipmentContext, recipeContext, favouritesContext, variationContext, memoryContext] =
        await Promise.all([
          readEquipmentContext(db, 'chefChat'),
          input.recipeId ? readRecipeContext(db, input.recipeId) : Promise.resolve(''),
          // Joins the existing Promise.all rather than adding a serial round-trip.
          readFavouritesContext(db),
          // The base recipe of a variation chat (issue #763). Reuses the same
          // reader, which returns '' for a deleted or corrupt doc — so a variation
          // whose base disappears mid-conversation quietly becomes an ordinary
          // chat instead of failing the turn (Rule 10).
          input.basedOnRecipeId
            ? readRecipeContext(db, input.basedOnRecipeId)
            : Promise.resolve(''),
          // The household's notes (issue #816). Joins the existing Promise.all
          // rather than adding a serial round-trip — it is one small collection
          // read, and it costs the turn nothing it was not already waiting on.
          readKitchenMemoryContext(db, 'chefChat'),
        ]);

      const systemPrompt = buildSystemPrompt(
        equipmentContext,
        recipeContext,
        favouritesContext,
        variationContext,
        memoryContext,
        input.speaker,
      );

      // Convert Message[] history to Genkit MessageData format. Our domain role is
      // 'user' | 'assistant'; Genkit/Gemini uses 'user' | 'model', so the assistant
      // turns must be remapped (a bare cast leaves 'assistant' at runtime, which
      // Genkit rejects with "messages.N.role: must be equal to one of the allowed
      // values").
      const history = input.messages.map((m) => ({
        role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        content: [{ text: m.text }],
      }));

      // Pro-tier model for conversational quality (design principle #3, issue #206).
      const chatModel = await flowModel('pro', 'chefChat');
      const { stream, response } = ai.generateStream({
        model: chatModel,
        system: systemPrompt,
        messages: history,
        prompt: input.newMessage,
      });

      // The DRAIN is what needs the deadline, not what follows it (issue #915).
      // This loop used to be bare, with withAiTimeout applied afterwards to the
      // aggregated `response` — which a model that goes quiet mid-stream never
      // reaches, so the turn hung until the 120s function quota killed it.
      // withAiStreamTimeout races each chunk against an idle timer instead: a
      // silence longer than the budget throws AiTimeoutError into the catch
      // below, and a long answer that keeps arriving is never cut short.
      for await (const chunk of withAiStreamTimeout('chefChat', stream)) {
        const text = chunk.text;
        if (text) streamingCallback(text);
      }

      // The stream has fully drained above, so this resolves immediately in the
      // normal case; the timeout stays as a backstop. AI model/token/cost
      // telemetry rides the Genkit model span the AI-OTLP processor ships to
      // PostHog (#356) — and span-derived usage fixes the old streamed-response
      // empty-tokens gap.
      const finalResponse = await withAiTimeout('chefChat', () => response, AI_TEXT_FLOW_TIMEOUT);

      return finalResponse.text;
    } catch (err) {
      // onCallGenkit owns this callable's error path; report the AI/Genkit
      // failure (incl. AiTimeoutError, or a mid-stream model error) here, flush,
      // then re-throw unchanged. Best-effort; never throws.
      await reportFlowError(err);
      throw err;
    }
  },
);

const CHEF_SYSTEM_BASE = `You are a skilled, knowledgeable kitchen assistant and conversational chef. \
Your goal is to have genuinely helpful, creative, and practical cooking conversations. \
You can discuss recipes, techniques, flavour pairings, substitutions, dietary adaptations, \
and anything else related to cooking and food. \
Speak naturally and warmly — like a knowledgeable friend in the kitchen, not a recipe generator. \
When you suggest a recipe or technique, feel free to riff, improvise, and add your own perspective. \
You are not bound to any particular list of ingredients. \
${UK_INGREDIENT_PRINCIPLE} \
Always use metric units: temperatures in °C only, ingredient quantities in g or ml. \
Dry ingredients always use g — never ml — even when the original measure is tsp or tbsp. \
Liquids (water, milk, oil, etc.) use ml. \
For small amounts where tsp or tbsp are more intuitive, you may use those but always include \
the metric equivalent in brackets — dry: "½ tsp salt (3 g)" or "1 tbsp sugar (12 g)"; \
liquid: "1 tbsp oil (15 ml)" or "1 tsp vanilla (5 ml)".`;
