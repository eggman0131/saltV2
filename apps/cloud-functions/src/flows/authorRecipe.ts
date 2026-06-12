import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { AuthorRecipeInputSchema, LibrarianOutputSchema } from '@salt/domain/schemas';
import type { LibrarianOutput } from '@salt/domain/schemas';
import type { RecipeDoc, IngredientGroupDoc } from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { canonicaliseRecipeIngredientsFlow } from './canonicaliseRecipeIngredients.js';

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

    const result = await withAiTimeout(
      'authorRecipe',
      () =>
        ai.generate({
          model: LIBRARIAN_MODEL,
          system: LIBRARIAN_SYSTEM,
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

  // Batch canonicalise all ingredient raw texts.
  let canonResults: Awaited<ReturnType<typeof canonicaliseRecipeIngredientsFlow>> = [];
  if (allIngredients.length > 0) {
    try {
      canonResults = await canonicaliseRecipeIngredientsFlow({
        items: allIngredients.map((i) => ({ rawName: i.rawText, rawText: i.rawText })),
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
      tags: raw.tags,
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
  Each ingredient: rawText (verbatim as stated), isOptional (true only if explicitly optional),
  firstUsedInStepOrdinal (0-based index into the steps array for the first step that uses this
  ingredient; null if the ingredient has no obvious first step).
- steps: numbered method steps. Each step: text (clear instruction), timerMinutes (integer or null),
  note (clarification or null).
- notes: chef's overall notes or tips, or null.

Extract only what is present in the conversation. Do not invent ingredients or steps not discussed.`;
