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
  `  EVERY quantified ingredient must be converted to metric "g" or "ml" — including count/item-based`,
  `  and pack-based ingredients (cloves, rashers, packets, bunches, cans, tins, jars, heads, sprigs,`,
  `  sticks, sheets, slices, eggs, whole vegetables, etc.). Estimate their metric weight or volume`,
  `  using the conversion table below and put the original count/pack form into displayText.`,
  `  Null ONLY for genuinely unquantifiable items ("salt to taste", "a pinch", "to serve"), where`,
  `  quantity is also null.`,
  `- item: the ingredient name after stripping quantity, unit, and preparation phrases.`,
  `- preparation: array of preparation phrases (e.g. ["sifted", "finely chopped"]). Empty array if none.`,
  `- notes: any parenthetical notes not covered by preparation. Null if none.`,
  `- isOptional: true if the line says "optional" or is clearly a garnish; false otherwise.`,
  `- displayText: the original human-friendly quantity form from the source line. It carries BOTH`,
  `  non-metric measures (e.g. "½ tsp", "1 cup", "2 tbsp", "3 oz") AND count/pack forms (e.g.`,
  `  "2 cloves", "1 tin", "2 medium", "4 rashers", "1 bunch"). It lets the UI show "½ tsp (3 g)",`,
  `  "1 cup (240 ml)", or "2 cloves (6 g)" alongside the converted metric value.`,
  `  Set to null only when the source is already in g, kg, ml, or l, or when there is no quantity.`,
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
  `Tins / cans / jars / packets → standard as-sold pack weight (use ml for liquids):`,
  `  1 tin/can chopped tomatoes ≈ 400g, 1 can beans ≈ 400g (use the drained weight ≈ 240g ONLY when`,
  `  the line says "drained"), 1 tin coconut milk ≈ 400ml, 1 tin tuna ≈ 145g, 1 jar pasta sauce ≈ 500g,`,
  `  1 packet/sachet dried yeast ≈ 7g, 1 stock cube ≈ 10g.`,
  `Count produce & individually-counted items → per-unit weight estimate (multiply by the count):`,
  `  1 medium onion ≈ 150g, 1 medium carrot ≈ 75g, 1 clove garlic ≈ 3g, 1 medium potato ≈ 170g,`,
  `  1 medium tomato ≈ 120g, 1 stick celery ≈ 40g, 1 medium egg ≈ 50g, 1 rasher bacon ≈ 25g,`,
  `  1 medium apple ≈ 180g, 1 medium banana ≈ 120g, 1 lemon ≈ 100g, 1 lime ≈ 65g,`,
  `  1 bunch herbs ≈ 30g, 1 sprig herbs ≈ 3g, 1 spring onion ≈ 15g, 1 slice bread ≈ 35g,`,
  `  1 sheet filo pastry ≈ 20g, 1 chicken breast ≈ 175g, 1 chicken thigh ≈ 120g.`,
  `  For these, set quantity to the total estimated grams (count × per-unit), unit to "g" (or "ml" for`,
  `  liquids), and displayText to the original count form (e.g. "2 cloves", "1 tin", "2 medium").`,
  `Already g/kg/ml/l → store as-is, no displayText. Round to the nearest whole number.`,
  ``,
  `## Rules`,
  `1. rawText must be the original line exactly — never rephrase or correct it.`,
  `2. item must not be empty; if stripping leaves nothing, use the full rawText as item.`,
  `3. Preserve original casing in all string fields.`,
  `4. Do not merge multiple ingredients on one line into a single item.`,
].join('\n');
