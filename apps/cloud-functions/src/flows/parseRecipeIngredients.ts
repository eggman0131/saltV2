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
    // Recipe lists are much larger prompts than single-entry calls, so Flash can
    // take 30–50s on a full ingredient list. Use a higher timeout with no retry:
    // retrying a large legitimate request just doubles the wait for no gain.
    const result = await withAiTimeout(
      'parseRecipeIngredients',
      () =>
        ai.generate({
          model: GENERATION_MODEL,
          system: SYSTEM_INSTRUCTIONS,
          prompt: rawText,
          output: { schema: ParseRecipeIngredientsAIOutputSchema },
          config: { temperature: 0 },
        }),
      { timeoutMs: 55_000, retries: 0 },
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
          displayText: ingredient.displayText,
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
  `All quantities are stored in metric (g or ml). Temperatures are always in °C.`,
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
  `- quantity: the metric amount as a single value ({type:"single",value:n}) or range`,
  `  ({type:"range",min:n,max:n}). Always a decimal — never a fraction type for the canonical value.`,
  `  "2-3 tbsp oil" → {type:"range",min:30,max:45}; "2-3 tbsp flour" → {type:"range",min:16,max:24}.`,
  `  Null if no quantity.`,
  `- unit: the metric unit. Dry/solid ingredients always use "g". Liquid ingredients always use "ml".`,
  `  Null for count/item-based ingredients (cloves, rashers, packets, bunches, cans, tins, heads,`,
  `  pinches, sprigs, sticks, sheets, etc.) or when there is no quantity.`,
  `- item: the ingredient name after stripping quantity, unit, and preparation phrases.`,
  `- preparation: array of preparation phrases (e.g. ["sifted", "finely chopped"]). Empty array if none.`,
  `- notes: any parenthetical notes not covered by preparation. Null if none.`,
  `- isOptional: true if the line says "optional" or is clearly a garnish; false otherwise.`,
  `- displayText: the human-friendly quantity+unit string from the original line, e.g. "½ tsp",`,
  `  "1 cup", "2 tbsp", "3 oz". Set this when the source unit is non-metric (tsp, tbsp, cup, fl oz,`,
  `  oz, lb, etc.) — it lets the UI show "½ tsp (3 g)" or "1 cup (240 ml)" alongside the metric value.`,
  `  Set to null when the source is already in g, kg, ml, or l, or when there is no unit.`,
  ``,
  `## Metric conversion`,
  `Liquids (water, milk, oil, vinegar, stock, juice, cream, etc.) → ml:`,
  `  1 cup = 240ml, 1 fl oz = 30ml, 1 tbsp = 15ml, 1 tsp = 5ml.`,
  `Dry/solid ingredients → always g, even when measured in tsp or tbsp:`,
  `  1 cup plain flour ≈ 120g, 1 cup butter ≈ 227g, 1 cup caster sugar ≈ 200g,`,
  `  1 cup icing sugar ≈ 120g, 1 tbsp butter ≈ 14g, 1 tbsp flour ≈ 8g,`,
  `  1 tbsp sugar ≈ 12g, 1 tbsp salt ≈ 18g, 1 tsp salt ≈ 6g, 1 tsp sugar ≈ 4g,`,
  `  1 tsp baking powder ≈ 4g, 1 tsp ground spice/herb ≈ 2g.`,
  `Imperial weight (oz, lb) → g: 1 oz ≈ 28g, 1 lb ≈ 454g.`,
  `Already g/kg/ml/l → store as-is, no displayText. Round to the nearest whole number.`,
  ``,
  `## Rules`,
  `1. rawText must be the original line exactly — never rephrase or correct it.`,
  `2. item must not be empty; if stripping leaves nothing, use the full rawText as item.`,
  `3. Preserve original casing in all string fields.`,
  `4. Do not merge multiple ingredients on one line into a single item.`,
].join('\n');
