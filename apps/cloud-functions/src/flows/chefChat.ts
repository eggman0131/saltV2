import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { ChefChatInputSchema } from '@salt/domain/schemas';
import { RecipeSchema } from '@salt/domain/schemas';
import { CanonItemSchema, CanonPurchaseCountsSchema } from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { flowModel } from '../ai/fakeModel.js';
import { reportFlowError } from '../observability/reportServerError.js';
import { UK_INGREDIENT_PRINCIPLE } from './ingredientConversions.js';
import { readEquipmentContext, equipmentSectionForChef } from './equipmentContext.js';

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
    const ingredientLines: string[] = [];
    for (const group of r.ingredients) {
      if (group.name) ingredientLines.push(`${group.name}:`);
      for (const ing of group.items) {
        ingredientLines.push(`  - ${ing.rawText}${ing.isOptional ? ' (optional)' : ''}`);
      }
    }
    const stepLines = r.steps.map((s, i) => `  ${i + 1}. ${s.text}`);
    const parts = [`Recipe: ${r.title}`];
    if (r.description) parts.push(`Description: ${r.description}`);
    if (ingredientLines.length > 0) parts.push(`Ingredients:\n${ingredientLines.join('\n')}`);
    if (stepLines.length > 0) parts.push(`Method:\n${stepLines.join('\n')}`);
    return parts.join('\n\n');
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

function buildSystemPrompt(
  equipmentContext: string,
  recipeContext: string,
  favouritesContext: string,
): string {
  const sections: string[] = [CHEF_SYSTEM_BASE];

  const equipmentSection = equipmentSectionForChef(equipmentContext);
  if (equipmentSection) sections.push(equipmentSection);

  if (favouritesContext) sections.push(favouritesContext);

  if (recipeContext) {
    sections.push(
      `## Current recipe\nThe user is asking about this recipe. Use it as context for the conversation.\n\n${recipeContext}`,
    );
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
      const [equipmentContext, recipeContext, favouritesContext] = await Promise.all([
        readEquipmentContext(db, 'chefChat'),
        input.recipeId ? readRecipeContext(db, input.recipeId) : Promise.resolve(''),
        // Joins the existing Promise.all rather than adding a serial round-trip.
        readFavouritesContext(db),
      ]);

      const systemPrompt = buildSystemPrompt(equipmentContext, recipeContext, favouritesContext);

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

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) streamingCallback(text);
      }

      // The stream is already draining above; await the resolved aggregated
      // response under the existing timeout. AI model/token/cost telemetry rides
      // the Genkit model span the AI-OTLP processor ships to PostHog (#356) — and
      // span-derived usage fixes the old streamed-response empty-tokens gap.
      const finalResponse = await withAiTimeout('chefChat', () => response, {
        timeoutMs: 55_000,
        retries: 0,
      });

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
