import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { AuthorRecipeInputSchema, LibrarianOutputSchema, RecipeSchema } from '@salt/domain/schemas';
import type { LibrarianOutput } from '@salt/domain/schemas';
import type { RecipeDoc, IngredientGroupDoc, IngredientDoc } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { canonicaliseRecipeIngredientsFlow } from './canonicaliseRecipeIngredients.js';
import { parseRecipeIngredientsFlow } from './parseRecipeIngredients.js';
import { resolveModel } from '../ai/resolveModel.js';
import { CATEGORY_TAG_RULES, normaliseTags } from './categoryTags.js';
import { INGREDIENT_SUBSTITUTION_RULES } from './ingredientConversions.js';

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
        ? `\n\nExisting category tags in this recipe collection (prefer these where they genuinely fit; add a new tag only if meaningfully different, and still never an ingredient): ${input.existingTags.join(', ')}.`
        : '';

    // Edit mode: ground the librarian on the existing recipe so it returns the
    // FULL recipe with the conversation's changes applied, rather than authoring
    // a near-empty recipe from an incremental edit chat (e.g. "add some cheese").
    // We keep the structured doc (not just the prompt text) so assembleDraft can
    // diff against it and skip re-parsing/re-embedding unchanged ingredients.
    const baseRecipe = input.recipeId ? await readBaseRecipe(getFirestore(), input.recipeId) : null;
    const closing = baseRecipe
      ? editModeSection(formatRecipeForPrompt(baseRecipe))
      : CREATE_MODE_CLOSING;
    const systemPrompt = `${LIBRARIAN_SYSTEM}\n\n${closing}${tagVocab}`;

    // Flash + temperature:0 for the librarian — accuracy over creativity (issue #206).
    const modelId = await resolveModel('fast', 'authorRecipe');
    const model = googleAI.model(modelId);
    const result = await withAiTimeout(
      'authorRecipe',
      () =>
        ai.generate({
          model,
          system: systemPrompt,
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

    // Human-readable top-level span name for the end-to-end trace view. The flow
    // span is the active span inside an ai.defineFlow body; setActiveSpanName
    // renames it (caps at 80 chars, no-op when no span is active). Recipe title is
    // only known after the librarian generates, so name it here.
    setActiveSpanName(`Author recipe: ${parsed.data.title}`);

    return assembleDraft(parsed.data, baseRecipe);
  },
);

async function assembleDraft(
  raw: LibrarianOutput,
  baseRecipe: RecipeDoc | null = null,
): Promise<RecipeDoc> {
  const now = new Date().toISOString();

  // Assign stable IDs to steps first so we can resolve step ordinals → IDs.
  const steps = raw.steps.map((s) => ({
    id: crypto.randomUUID(),
    text: s.text,
    timer: s.timerMinutes !== null ? { durationMinutes: s.timerMinutes, description: null } : null,
    note: s.note,
  }));

  // Edit mode: index the base recipe's ingredients by rawText. The librarian is
  // told to keep unchanged ingredients' rawText verbatim, so a byte-identical
  // rawText means "untouched" — we reuse its existing canon match, parsed data,
  // and id, and skip it entirely from the parse + canon (embedding) flows below.
  // Only genuinely new or edited ingredients get re-parsed and re-embedded, so a
  // one-line "add cheese" edit costs one canon match instead of N.
  const baseByRawText = new Map<string, IngredientDoc>();
  if (baseRecipe) {
    for (const group of baseRecipe.ingredients) {
      for (const ing of group.items) baseByRawText.set(ing.rawText, ing);
    }
  }

  // Flatten only the ingredients that actually need processing (new/edited).
  // In create mode baseByRawText is empty, so this is every ingredient — exactly
  // the previous behaviour.
  const toProcess: string[] = [];
  const seen = new Set<string>();
  for (const group of raw.ingredientGroups) {
    for (const ing of group.ingredients) {
      if (baseByRawText.has(ing.rawText) || seen.has(ing.rawText)) continue;
      seen.add(ing.rawText);
      toProcess.push(ing.rawText);
    }
  }

  // Parse raw texts to extract clean item names (strips quantity, unit, prep phrases).
  // This mirrors what recipeService.canonicaliseIngredients does on the manual-entry path
  // and ensures the canon matching stages see "garlic" not "1 head of garlic".
  // We also retain the full structured `parsed` object (quantity/unit/displayText/etc.) keyed
  // by rawText so the assembled RecipeDoc threads it through instead of dropping it as null.
  // Duplicate rawText: last occurrence wins, matching parsedItemMap's tolerated behavior.
  const parsedItemMap = new Map<string, string>();
  type ParsedIngredient = Awaited<
    ReturnType<typeof parseRecipeIngredientsFlow>
  >[number]['items'][number]['parsed'];
  const parsedMap = new Map<string, ParsedIngredient>();
  if (toProcess.length > 0) {
    try {
      const joinedRawText = toProcess.join('\n');
      const parseResult = await parseRecipeIngredientsFlow({ rawText: joinedRawText });
      for (const group of parseResult) {
        for (const item of group.items) {
          if (item.parsed?.item) parsedItemMap.set(item.rawText, item.parsed.item);
          if (item.parsed) parsedMap.set(item.rawText, item.parsed);
        }
      }
    } catch {
      // Parse failure is non-fatal — fall back to rawText as rawName below
      // and to parsed: null on the assembled ingredient.
    }
  }

  // Batch canonicalise only the to-process raw texts; key results by rawText so
  // the assembly step below can look each one up directly.
  type CanonResult = Awaited<ReturnType<typeof canonicaliseRecipeIngredientsFlow>>[number];
  const canonByRawText = new Map<string, CanonResult>();
  if (toProcess.length > 0) {
    try {
      const canonResults = await canonicaliseRecipeIngredientsFlow({
        items: toProcess.map((rawText) => ({
          rawName: parsedItemMap.get(rawText) ?? rawText,
          rawText,
        })),
      });
      toProcess.forEach((rawText, k) => {
        const r = canonResults[k];
        if (r) canonByRawText.set(rawText, r);
      });
    } catch {
      // Canon failure is non-fatal — ingredients land as pending.
    }
  }

  // Assemble ingredient groups with IDs, canon results, and firstUsedInStepId.
  const ingredientGroups: IngredientGroupDoc[] = raw.ingredientGroups.map((group) => ({
    id: crypto.randomUUID(),
    name: group.name,
    items: group.ingredients.map((ing) => {
      // Resolve step ordinal → step ID. Always taken from the fresh librarian
      // output so reordered steps / flipped optional flags are respected even on
      // otherwise-unchanged ingredients.
      const ord = ing.firstUsedInStepOrdinal;
      const firstUsedInStepId =
        ord !== null && ord >= 0 && ord < steps.length ? steps[ord]!.id : null;

      // Unchanged ingredient — carry the existing canon match, parsed data, and
      // id straight over (it was never sent to parse/canon above).
      const base = baseByRawText.get(ing.rawText);
      if (base) {
        return {
          id: base.id,
          rawText: ing.rawText,
          parsed: base.parsed,
          canonId: base.canonId,
          matchState: base.matchState,
          isOptional: ing.isOptional,
          firstUsedInStepId,
        };
      }

      const canon = canonByRawText.get(ing.rawText);
      const canonId = canon && canon.kind === 'ok' ? (canon.value.item as { id: string }).id : null;
      const matchState: 'matched' | 'pending' | 'failed' =
        canon && canon.kind === 'ok' ? 'matched' : canon ? 'failed' : 'pending';

      return {
        id: crypto.randomUUID(),
        rawText: ing.rawText,
        parsed: parsedMap.get(ing.rawText) ?? null,
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
      tags: normaliseTags(raw.tags),
    },
    source: { type: 'manual' },
    notes: raw.notes,
    // Preserve the existing "makes" link on an edit-mode amend; null on create.
    // The librarian never touches it, so carry the base value straight through.
    producesCanonId: baseRecipe?.producesCanonId ?? null,
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
${CATEGORY_TAG_RULES}
${INGREDIENT_SUBSTITUTION_RULES}
- ingredientGroups: group ingredients by course/stage (null name = default group).
  Each ingredient: rawText (preserve the original wording and any tsp/tbsp/cup measures the chef
  used, but always use the British ingredient NAMES above — e.g. "double cream" not "heavy cream"),
  isOptional (true only if explicitly optional),
  firstUsedInStepOrdinal (0-based index into the steps array for the first step that uses this
  ingredient; null if the ingredient has no obvious first step).
- steps: numbered method steps. Each step: text (clear instruction), timerMinutes (integer or null),
  note: a genuine warning or non-obvious caveat only — something that would ruin the dish if missed
  (e.g. "don't let the heat exceed 80°C or the custard will scramble"). Leave null for routine
  instructions; most steps should have no note. All temperatures must be in °C only — never Fahrenheit.
- notes: chef's overall notes or tips, or null.`;

// Create mode: the conversation is the only source of truth.
const CREATE_MODE_CLOSING = `Extract only what is present in the conversation. \
Do not invent ingredients or steps not discussed.`;

// Edit mode: the existing recipe is the source of truth and the conversation
// describes a delta to apply. Without this, the librarian (told to "extract only
// what is present in the conversation") drops everything not mentioned in the
// edit chat — saving a recipe that is just the change.
function editModeSection(baseRecipe: string): string {
  return `## Editing an existing recipe
The user is refining a recipe that ALREADY EXISTS. Its current full content is below, \
and the conversation describes the change(s) they want to make to it.

Return the COMPLETE updated recipe: start from the current recipe and apply ONLY the \
changes discussed in the conversation. Preserve every ingredient, step, time, serving \
count, tag, and detail the conversation does not change — keep the original wording \
(rawText) of unchanged ingredients verbatim. Do not drop anything that was not discussed. \
Integrate additions (e.g. a new ingredient) into the appropriate group and reference them \
from the relevant steps.

### Current recipe
${baseRecipe}`;
}

// Reads and validates the existing recipe for edit mode. Returns null on a
// missing/corrupt doc or any failure, so edit mode degrades to create mode
// rather than throwing.
async function readBaseRecipe(
  db: ReturnType<typeof getFirestore>,
  recipeId: string,
): Promise<RecipeDoc | null> {
  try {
    const snap = await db.collection('recipes').doc(recipeId).get();
    if (!snap.exists) return null;
    const result = RecipeSchema.safeParse(snap.data());
    if (!result.success) {
      logger.warn('authorRecipe: base recipe failed validation', { recipeId });
      return null;
    }
    return result.data;
  } catch (err) {
    logger.warn('authorRecipe: failed to read base recipe', { recipeId, err });
    return null;
  }
}

// Renders the existing recipe as plain text for the librarian's system prompt.
// Mirrors chefChat's readRecipeContext but is richer: it includes
// servings/times/tags/notes/timers so the librarian can faithfully reproduce the
// whole recipe, not just title + ingredients + method.
function formatRecipeForPrompt(r: RecipeDoc): string {
  const parts: string[] = [`Title: ${r.title}`];
  if (r.description) parts.push(`Description: ${r.description}`);

  const meta: string[] = [];
  if (r.metadata.servings != null) meta.push(`servings: ${r.metadata.servings}`);
  if (r.metadata.prepTimeMinutes != null) meta.push(`prep: ${r.metadata.prepTimeMinutes} min`);
  if (r.metadata.cookTimeMinutes != null) meta.push(`cook: ${r.metadata.cookTimeMinutes} min`);
  if (r.metadata.totalTimeMinutes != null) meta.push(`total: ${r.metadata.totalTimeMinutes} min`);
  if (meta.length > 0) parts.push(meta.join(', '));
  if (r.metadata.tags.length > 0) parts.push(`Tags: ${r.metadata.tags.join(', ')}`);

  const ingredientLines: string[] = [];
  for (const group of r.ingredients) {
    if (group.name) ingredientLines.push(`${group.name}:`);
    for (const ing of group.items) {
      ingredientLines.push(`  - ${ing.rawText}${ing.isOptional ? ' (optional)' : ''}`);
    }
  }
  if (ingredientLines.length > 0) parts.push(`Ingredients:\n${ingredientLines.join('\n')}`);

  const stepLines = r.steps.map((s, i) => {
    const timer = s.timer ? ` [timer: ${s.timer.durationMinutes} min]` : '';
    const note = s.note ? ` (note: ${s.note})` : '';
    return `  ${i + 1}. ${s.text}${timer}${note}`;
  });
  if (stepLines.length > 0) parts.push(`Method:\n${stepLines.join('\n')}`);

  if (r.notes) parts.push(`Notes: ${r.notes}`);

  return parts.join('\n\n');
}
