import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { AuthorRecipeInputSchema, LibrarianOutputSchema } from '@salt/domain/schemas';
import type { LibrarianOutput } from '@salt/domain/schemas';
import type { RecipeDoc, IngredientGroupDoc } from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { canonicaliseRecipeIngredientsFlow } from './canonicaliseRecipeIngredients.js';
import { parseRecipeIngredientsFlow } from './parseRecipeIngredients.js';

// Flash + temperature:0 for the librarian — accuracy over creativity (issue #206).
const LIBRARIAN_MODEL = googleAI.model('gemini-flash-latest');

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
        ? `\n\nExisting tags in this recipe collection (prefer these where appropriate; add a new tag only if meaningfully different): ${input.existingTags.join(', ')}.`
        : '';

    const result = await withAiTimeout(
      'authorRecipe',
      () =>
        ai.generate({
          model: LIBRARIAN_MODEL,
          system: LIBRARIAN_SYSTEM + tagVocab,
          prompt: conversationText,
          output: { schema: LibrarianOutputSchema },
          config: { temperature: 0 },
        }),
      { timeoutMs: 55_000, retries: 0 },
    );

    const parsed = LibrarianOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`Librarian returned invalid recipe structure: ${parsed.error.message}`);
    }

    return assembleDraft(parsed.data);
  },
);

async function assembleDraft(raw: LibrarianOutput): Promise<RecipeDoc> {
  const now = new Date().toISOString();

  // Assign stable IDs to steps first so we can resolve step ordinals → IDs.
  const steps = raw.steps.map((s) => ({
    id: crypto.randomUUID(),
    text: s.text,
    timer: s.timerMinutes !== null ? { durationMinutes: s.timerMinutes, description: null } : null,
    note: s.note,
  }));

  // Flatten all ingredients for batch canonicalisation.
  type IngMeta = { groupIdx: number; itemIdx: number; rawText: string };
  const allIngredients: IngMeta[] = [];
  for (let gi = 0; gi < raw.ingredientGroups.length; gi++) {
    const group = raw.ingredientGroups[gi]!;
    for (let ii = 0; ii < group.ingredients.length; ii++) {
      allIngredients.push({ groupIdx: gi, itemIdx: ii, rawText: group.ingredients[ii]!.rawText });
    }
  }

  // Parse raw texts to extract clean item names (strips quantity, unit, prep phrases).
  // This mirrors what recipeService.canonicaliseIngredients does on the manual-entry path
  // and ensures the canon matching stages see "garlic" not "1 head of garlic".
  const parsedItemMap = new Map<string, string>();
  if (allIngredients.length > 0) {
    try {
      const joinedRawText = allIngredients.map((i) => i.rawText).join('\n');
      const parseResult = await parseRecipeIngredientsFlow({ rawText: joinedRawText });
      for (const group of parseResult) {
        for (const item of group.items) {
          if (item.parsed?.item) parsedItemMap.set(item.rawText, item.parsed.item);
        }
      }
    } catch {
      // Parse failure is non-fatal — fall back to rawText as rawName below.
    }
  }

  // Batch canonicalise all ingredient raw texts.
  let canonResults: Awaited<ReturnType<typeof canonicaliseRecipeIngredientsFlow>> = [];
  if (allIngredients.length > 0) {
    try {
      canonResults = await canonicaliseRecipeIngredientsFlow({
        items: allIngredients.map((i) => ({
          rawName: parsedItemMap.get(i.rawText) ?? i.rawText,
          rawText: i.rawText,
        })),
      });
    } catch {
      // Canon failure is non-fatal — ingredients land as pending.
    }
  }

  // Assemble ingredient groups with IDs, canon results, and firstUsedInStepId.
  const ingredientGroups: IngredientGroupDoc[] = raw.ingredientGroups.map((group, gi) => ({
    id: crypto.randomUUID(),
    name: group.name,
    items: group.ingredients.map((ing, ii) => {
      const flatIdx = allIngredients.findIndex((m) => m.groupIdx === gi && m.itemIdx === ii);
      const canon = flatIdx >= 0 ? canonResults[flatIdx] : undefined;

      const canonId = canon && canon.kind === 'ok' ? (canon.value.item as { id: string }).id : null;
      const matchState: 'matched' | 'pending' | 'failed' =
        canon && canon.kind === 'ok' ? 'matched' : canon ? 'failed' : 'pending';

      // Resolve step ordinal → step ID.
      const ord = ing.firstUsedInStepOrdinal;
      const firstUsedInStepId =
        ord !== null && ord >= 0 && ord < steps.length ? steps[ord]!.id : null;

      return {
        id: crypto.randomUUID(),
        rawText: ing.rawText,
        parsed: null,
        canonId,
        matchState,
        isOptional: ing.isOptional,
        firstUsedInStepId,
      };
    }),
  }));

  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    title: raw.title,
    description: raw.description,
    ingredients: ingredientGroups,
    steps,
    metadata: {
      servings: raw.servings,
      totalTimeMinutes: raw.totalTimeMinutes,
      prepTimeMinutes: raw.prepTimeMinutes,
      cookTimeMinutes: raw.cookTimeMinutes,
      tags: raw.tags
        .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
        .filter((t) => t.length > 0),
    },
    source: { type: 'manual' },
    notes: raw.notes,
    image: null,
    createdAt: now,
    updatedAt: now,
  };
}

const LIBRARIAN_SYSTEM = `You are a precise recipe extraction assistant. \
Given a cooking conversation between a user and a chef, extract and structure a complete recipe. \

## Rules
- title: clear, concise recipe name.
- description: 1–2 sentence summary, or null.
- servings: integer portions, or null if not stated.
- totalTimeMinutes/prepTimeMinutes/cookTimeMinutes: integers in minutes, or null.
- tags: short lowercase keywords (e.g. ["vegetarian","quick","pasta"]). Empty array if none.
- ingredientGroups: group ingredients by course/stage (null name = default group).
  Each ingredient: rawText (verbatim as stated — preserve the original wording including any
  tsp/tbsp/cup measures the chef used), isOptional (true only if explicitly optional),
  firstUsedInStepOrdinal (0-based index into the steps array for the first step that uses this
  ingredient; null if the ingredient has no obvious first step).
- steps: numbered method steps. Each step: text (clear instruction), timerMinutes (integer or null),
  note: a genuine warning or non-obvious caveat only — something that would ruin the dish if missed
  (e.g. "don't let the heat exceed 80°C or the custard will scramble"). Leave null for routine
  instructions; most steps should have no note. All temperatures must be in °C only — never Fahrenheit.
- notes: chef's overall notes or tips, or null.

Extract only what is present in the conversation. Do not invent ingredients or steps not discussed.`;
