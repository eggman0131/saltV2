import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { ChefChatInputSchema } from '@salt/domain/schemas';
import { RecipeSchema } from '@salt/domain/schemas';
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

function buildSystemPrompt(equipmentContext: string, recipeContext: string): string {
  const sections: string[] = [CHEF_SYSTEM_BASE];

  const equipmentSection = equipmentSectionForChef(equipmentContext);
  if (equipmentSection) sections.push(equipmentSection);

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
      const [equipmentContext, recipeContext] = await Promise.all([
        readEquipmentContext(db, 'chefChat'),
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
