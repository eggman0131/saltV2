import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { ChefChatInputSchema } from '@salt/domain/schemas';
import {
  EquipmentManifestSchema,
  RecipeSchema,
  EQUIPMENT_MANIFEST_COLLECTION,
  EQUIPMENT_MANIFEST_DOC_ID,
} from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { flowModel, aiModelLabel } from '../ai/fakeModel.js';
import { tracedGenerate } from '../ai/aiGenerationTelemetry.js';

async function readEquipmentContext(db: ReturnType<typeof getFirestore>): Promise<string> {
  try {
    const snap = await db
      .collection(EQUIPMENT_MANIFEST_COLLECTION)
      .doc(EQUIPMENT_MANIFEST_DOC_ID)
      .get();
    if (!snap.exists) return '';
    const result = EquipmentManifestSchema.safeParse(snap.data());
    if (!result.success) {
      logger.warn('chefChat: equipmentManifest failed validation, proceeding without kit context');
      return '';
    }
    const { items } = result.data;
    if (items.length === 0) return '';
    const lines = items.map((item) => {
      const parts = [`- ${item.name}`];
      const ownedAccessories = item.accessories.filter((a) => a.owned);
      if (ownedAccessories.length > 0) {
        parts.push(`  accessories: ${ownedAccessories.map((a) => a.name).join(', ')}`);
      }
      if (item.rules.length > 0) {
        parts.push(`  notes: ${item.rules.join('; ')}`);
      }
      return parts.join('\n');
    });
    return lines.join('\n');
  } catch (err) {
    logger.warn('chefChat: failed to read equipmentManifest', { err });
    return '';
  }
}

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

function buildSystemPrompt(equipmentContext: string, recipeContext: string): string {
  const sections: string[] = [CHEF_SYSTEM_BASE];

  if (equipmentContext) {
    sections.push(
      `## Your equipment\nThe following kitchen equipment is available. Draw on it when it genuinely helps the conversation, but never feel obliged to mention or use it.\n\n${equipmentContext}`,
    );
  }

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
    const db = getFirestore();
    const [equipmentContext, recipeContext] = await Promise.all([
      readEquipmentContext(db),
      input.recipeId ? readRecipeContext(db, input.recipeId) : Promise.resolve(''),
    ]);

    const systemPrompt = buildSystemPrompt(equipmentContext, recipeContext);

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
    const modelLabel = await aiModelLabel('pro', 'chefChat');
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

    // Emit $ai_generation off the final aggregated response (carries usage). The
    // stream itself is already draining above; tracedGenerate just awaits the
    // resolved response under the existing timeout and records model/tokens/latency.
    const finalResponse = await withAiTimeout(
      'chefChat',
      () => tracedGenerate('chefChat', modelLabel, () => response),
      {
        timeoutMs: 55_000,
        retries: 0,
      },
    );

    return finalResponse.text;
  },
);

const CHEF_SYSTEM_BASE = `You are a skilled, knowledgeable kitchen assistant and conversational chef. \
Your goal is to have genuinely helpful, creative, and practical cooking conversations. \
You can discuss recipes, techniques, flavour pairings, substitutions, dietary adaptations, \
and anything else related to cooking and food. \
Speak naturally and warmly — like a knowledgeable friend in the kitchen, not a recipe generator. \
When you suggest a recipe or technique, feel free to riff, improvise, and add your own perspective. \
You are not bound to any particular list of ingredients or equipment. \
Always use metric units: temperatures in °C only, ingredient quantities in g or ml. \
Dry ingredients always use g — never ml — even when the original measure is tsp or tbsp. \
Liquids (water, milk, oil, etc.) use ml. \
For small amounts where tsp or tbsp are more intuitive, you may use those but always include \
the metric equivalent in brackets — dry: "½ tsp salt (3 g)" or "1 tbsp sugar (12 g)"; \
liquid: "1 tbsp oil (15 ml)" or "1 tsp vanilla (5 ml)".`;
