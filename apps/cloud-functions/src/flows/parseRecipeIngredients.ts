import { googleAI } from '@genkit-ai/google-genai';
import {
  ParseRecipeIngredientsInputSchema,
  ParseRecipeIngredientsAIOutputSchema,
  ParseRecipeIngredientsOutputSchema,
} from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';

const GENERATION_MODEL = googleAI.model('gemini-flash-latest');

export const parseRecipeIngredientsFlow = ai.defineFlow(
  {
    name: 'parseRecipeIngredients',
    inputSchema: ParseRecipeIngredientsInputSchema,
    outputSchema: ParseRecipeIngredientsOutputSchema,
  },
  async ({ rawText }) => {
    const result = await withAiTimeout('parseRecipeIngredients', () =>
      ai.generate({
        model: GENERATION_MODEL,
        system: SYSTEM_INSTRUCTIONS,
        prompt: rawText,
        output: { schema: ParseRecipeIngredientsAIOutputSchema },
        config: { temperature: 0 },
      }),
    );

    const parsed = ParseRecipeIngredientsAIOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`AI returned invalid ingredient structure: ${parsed.error.message}`);
    }

    return parsed.data.groups.map((group) => ({
      id: crypto.randomUUID(),
      name: group.name,
      items: group.items.map((ingredient) => ({
        id: crypto.randomUUID(),
        rawText: ingredient.rawText,
        parsed: {
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          item: ingredient.item,
          preparation: ingredient.preparation,
          notes: ingredient.notes,
        },
        canonId: null,
        matchState: 'pending' as const,
        isOptional: ingredient.isOptional,
        firstUsedInStepId: null,
      })),
    }));
  },
);

const SYSTEM_INSTRUCTIONS = [
  `You are a recipe ingredient parser. Parse the ingredient list into structured groups and ingredients.`,
  ``,
  `## Detecting groups`,
  `A section header is a line that ends with a colon (e.g. "For the sauce:", "Dressing:") or is a short`,
  `standalone phrase (1–4 words) with no quantity, unit, or preparation cues.`,
  `When you encounter a header, start a new group with that header text (without the trailing colon) as`,
  `the name. Ingredients before any header belong to a group with name null.`,
  ``,
  `## Parsing each ingredient line`,
  `For each ingredient line, extract:`,
  `- rawText: the original line verbatim — copy it exactly, do not alter it`,
  `- quantity: the leading amount — use single ({type:"single",value:n}), range ({type:"range",min:n,max:n}),`,
  `  or mixed fraction ({type:"mixed",whole:n,numerator:n,denominator:n}).`,
  `  "1 ½" → whole:1,numerator:1,denominator:2; bare "½" → whole:0,numerator:1,denominator:2;`,
  `  "2-3" or "2–3" → {type:"range",min:2,max:3}. Null if no quantity.`,
  `- unit: the unit immediately after the quantity (e.g. "cup", "g", "tbsp"). Null if none.`,
  `- item: the ingredient name after stripping quantity, unit, and preparation phrases.`,
  `- preparation: array of preparation phrases (e.g. ["sifted", "finely chopped"]). Empty array if none.`,
  `- notes: any parenthetical notes not covered by preparation. Null if none.`,
  `- isOptional: true if the line says "optional" or is clearly a garnish; false otherwise.`,
  ``,
  `## Rules`,
  `1. rawText must be the original line exactly — never rephrase or correct it.`,
  `2. item must not be empty; if stripping leaves nothing, use the full rawText as item.`,
  `3. Fractional range bounds use decimals: "½-1" → min:0.5, max:1.`,
  `4. Preserve original casing in all string fields.`,
  `5. Do not merge multiple ingredients on one line into a single item.`,
].join('\n');
