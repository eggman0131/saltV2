import { googleAI } from '@genkit-ai/google-genai';
import {
  CategoriseRecipeInputSchema,
  CategoriseRecipeAIOutputSchema,
  CategoriseRecipeOutputSchema,
} from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';
import { CATEGORY_TAG_RULES, normaliseTags } from './categoryTags.js';

// categoriseRecipe (issue: tighten recipe categories). Given a recipe's content,
// returns clean search/filter category tags under the SHARED category-tag rules
// (categoryTags.ts) — the same policy the authoring flows apply, so a
// (re)categorised recipe is indistinguishable from a freshly-authored one.
//
// Used by the recategorise-recipes backfill to replace the pre-rules tag soup on
// existing recipes, and reusable behind a future "re-categorise" UI action. It
// derives tags from title/description/ingredients/steps but NEVER echoes an
// ingredient back as a tag — the rules forbid it and the ingredient list is
// already searchable.

const CATEGORISE_SYSTEM = `You classify a single recipe into a small set of category tags for search and filtering. \
You are given the recipe's title, description, ingredients and method. Return ONLY the tags — do not restate the recipe.

## Tag rules
${CATEGORY_TAG_RULES}

Base the tags on what the whole dish IS (its cuisine, course, form, dietary profile and character), inferred from \
the title and method — not on a checklist of its ingredients. Prefer a handful of accurate, broadly-useful tags \
over many narrow ones. Do not invent marketing-style or hyper-specific tags (e.g. no "mary-berry-favourites", \
"rainy-day-food", "proper-pub-grub").`;

export const categoriseRecipeFlow = ai.defineFlow(
  {
    name: 'categoriseRecipe',
    inputSchema: CategoriseRecipeInputSchema,
    outputSchema: CategoriseRecipeOutputSchema,
  },
  async ({ title, description, ingredients, steps }) => {
    const promptParts = [
      `Title: ${title}`,
      description ? `Description: ${description}` : null,
      ingredients.length > 0
        ? `Ingredients:\n${ingredients.map((i) => `- ${i}`).join('\n')}`
        : null,
      steps.length > 0 ? `Method:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : null,
    ].filter((p): p is string => p !== null);

    // Flash + temperature:0 — accuracy and cross-recipe consistency over creativity.
    const modelId = await resolveModel('fast');
    const model = googleAI.model(modelId);
    const result = await withAiTimeout(
      'categoriseRecipe',
      () =>
        ai.generate({
          model,
          system: CATEGORISE_SYSTEM,
          prompt: promptParts.join('\n\n'),
          output: { schema: CategoriseRecipeAIOutputSchema },
          config: { temperature: 0 },
        }),
      { timeoutMs: 55_000, retries: 0 },
    );

    const parsed = CategoriseRecipeAIOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`categoriseRecipe returned invalid output: ${parsed.error.message}`);
    }

    return { tags: normaliseTags(parsed.data.tags) };
  },
);
