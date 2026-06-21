import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { isHttpsScheme, parseImportUrl } from '@salt/domain';
import { ExtractRecipeFromUrlInputSchema, ExtractRecipeAIOutputSchema } from '@salt/domain/schemas';
import type { ExtractRecipeAIOutput, UrlImportFailureCode } from '@salt/domain/schemas';
import type { RecipeDoc, IngredientGroupDoc } from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { ssrfGuardedFetch, SsrfFetchError } from '../adapters/ssrfFetch.js';
import { canonicaliseRecipeIngredientsFlow } from './canonicaliseRecipeIngredients.js';
import { parseRecipeIngredientsFlow } from './parseRecipeIngredients.js';

// SSRF-hardened URL import (recipe URL import epic, Phase 1).
//
// Pipeline: validate URL → SSRF-guarded fetch (raw HTML) → Gemini extraction
// (metric + British conversion) → reuse parse/canonicalise flows for ingredient
// matching → assemble a RecipeDoc draft with source.type='url'.
//
// The flow throws a UrlImportError tagged with a failure code; the onCall
// entrypoint maps each code to the right HttpsError + user-facing copy.

// Flash + temperature:0 — accuracy over creativity, mirrors the librarian flow.
const EXTRACT_MODEL = googleAI.model('gemini-flash-latest');

// JSON-LD parsing is a LATER phase — we send the raw page HTML to the model and
// rely on it to find the recipe. Cap the HTML we forward so a huge page can't
// blow the prompt budget; recipes always appear well within the first chunk.
const MAX_HTML_CHARS = 200_000;

export type { UrlImportFailureCode };

export class UrlImportError extends Error {
  constructor(
    readonly code: UrlImportFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'UrlImportError';
  }
}

const OutputSchema = z.custom<RecipeDoc>();

export const extractRecipeFromUrlFlow = ai.defineFlow(
  {
    name: 'extractRecipeFromUrl',
    inputSchema: ExtractRecipeFromUrlInputSchema,
    outputSchema: OutputSchema,
  },
  async ({ url }): Promise<RecipeDoc> => {
    // 1. Validate the URL shape + scheme before any I/O. The SSRF guard does
    //    the resolved-IP enforcement; here we reject garbage and non-https.
    const parsed = parseImportUrl(url);
    if (parsed === null) {
      throw new UrlImportError('invalid-url', 'unparseable url');
    }
    if (!isHttpsScheme(parsed.protocol)) {
      throw new UrlImportError('blocked-url', 'non-https scheme');
    }

    // 2. SSRF-guarded fetch — raw HTML.
    let html: string;
    try {
      const fetched = await ssrfGuardedFetch(url);
      html = fetched.html;
    } catch (err) {
      if (err instanceof SsrfFetchError) {
        if (err.reason === 'blocked') {
          throw new UrlImportError('blocked-url', 'ssrf guard refused');
        }
        // dns / timeout / connection / http-status / too-large / wrong-content-type
        throw new UrlImportError('fetch-failed', `fetch failed: ${err.reason}`);
      }
      throw new UrlImportError('fetch-failed', 'fetch failed');
    }

    // 3. Gemini extraction + metric/British conversion.
    const trimmedHtml = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
    let extracted: ExtractRecipeAIOutput;
    try {
      const result = await withAiTimeout(
        'extractRecipeFromUrl',
        () =>
          ai.generate({
            model: EXTRACT_MODEL,
            system: EXTRACT_SYSTEM,
            prompt: `Source URL: ${parsed.href}\n\nPage HTML:\n${trimmedHtml}`,
            output: { schema: ExtractRecipeAIOutputSchema },
            config: { temperature: 0 },
          }),
        { timeoutMs: 55_000, retries: 0 },
      );
      const validated = ExtractRecipeAIOutputSchema.safeParse(result.output);
      if (!validated.success) {
        throw new UrlImportError(
          'ai-failed',
          `extractor returned invalid structure: ${validated.error.message}`,
        );
      }
      extracted = validated.data;
    } catch (err) {
      if (err instanceof UrlImportError) throw err;
      // AI timeout / transport / model error all surface as ai-failed.
      throw new UrlImportError('ai-failed', err instanceof Error ? err.message : 'ai error');
    }

    // 4. Did the model find a recipe?
    if (!extracted.isRecipe || extracted.ingredientGroups.length === 0) {
      throw new UrlImportError('not-a-recipe', 'no recipe found on page');
    }

    // 5. Assemble the draft (reuses parse + canonicalise flows).
    return assembleDraft(extracted, parsed.href);
  },
);

// Mirrors authorRecipe.assembleDraft: assign step IDs, parse ingredient raw
// texts to clean item names, batch-canonicalise, thread structured `parsed`,
// resolve step ordinals → IDs. Differs only in source.type='url' + url.
async function assembleDraft(raw: ExtractRecipeAIOutput, sourceUrl: string): Promise<RecipeDoc> {
  const now = new Date().toISOString();

  const steps = raw.steps.map((s) => ({
    id: crypto.randomUUID(),
    text: s.text,
    timer: s.timerMinutes !== null ? { durationMinutes: s.timerMinutes, description: null } : null,
    note: s.note,
  }));

  type IngMeta = { groupIdx: number; itemIdx: number; rawText: string };
  const allIngredients: IngMeta[] = [];
  for (let gi = 0; gi < raw.ingredientGroups.length; gi++) {
    const group = raw.ingredientGroups[gi]!;
    for (let ii = 0; ii < group.ingredients.length; ii++) {
      allIngredients.push({ groupIdx: gi, itemIdx: ii, rawText: group.ingredients[ii]!.rawText });
    }
  }

  // Parse raw texts → clean item names + structured parsed objects, keyed by
  // rawText. Parse failure is non-fatal (falls back to rawText / parsed:null).
  const parsedItemMap = new Map<string, string>();
  type ParsedIngredient = Awaited<
    ReturnType<typeof parseRecipeIngredientsFlow>
  >[number]['items'][number]['parsed'];
  const parsedMap = new Map<string, ParsedIngredient>();
  if (allIngredients.length > 0) {
    try {
      const joinedRawText = allIngredients.map((i) => i.rawText).join('\n');
      const parseResult = await parseRecipeIngredientsFlow({ rawText: joinedRawText });
      for (const group of parseResult) {
        for (const item of group.items) {
          if (item.parsed?.item) parsedItemMap.set(item.rawText, item.parsed.item);
          if (item.parsed) parsedMap.set(item.rawText, item.parsed);
        }
      }
    } catch {
      // non-fatal
    }
  }

  // Batch canonicalise. Failure is non-fatal — ingredients land as pending.
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
      // non-fatal
    }
  }

  const ingredientGroups: IngredientGroupDoc[] = raw.ingredientGroups.map((group, gi) => ({
    id: crypto.randomUUID(),
    name: group.name,
    items: group.ingredients.map((ing, ii) => {
      const flatIdx = allIngredients.findIndex((m) => m.groupIdx === gi && m.itemIdx === ii);
      const canon = flatIdx >= 0 ? canonResults[flatIdx] : undefined;

      const canonId = canon && canon.kind === 'ok' ? (canon.value.item as { id: string }).id : null;
      const matchState: 'matched' | 'pending' | 'failed' =
        canon && canon.kind === 'ok' ? 'matched' : canon ? 'failed' : 'pending';

      const ord = ing.firstUsedInStepOrdinal;
      const firstUsedInStepId =
        ord !== null && ord >= 0 && ord < steps.length ? steps[ord]!.id : null;

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
      tags: raw.tags
        .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
        .filter((t) => t.length > 0),
    },
    source: { type: 'url', url: sourceUrl },
    notes: raw.notes,
    image: null,
    createdAt: now,
    updatedAt: now,
  };
}

const EXTRACT_SYSTEM = `You are a precise recipe extraction assistant. You are given the raw HTML \
of a web page and its source URL. Extract a single complete recipe from the page and convert it \
fully to UK conventions.

## Is it a recipe?
- Set isRecipe=false (and leave the other fields at sensible empties) ONLY when the page contains no \
cooking recipe at all (e.g. a news article, a product listing, a 404). If a recipe is present, \
isRecipe=true.

## Conversion rules (apply to EVERYTHING)
- Metric only: convert all quantities to metric. Volumes in millilitres/litres, weights in grams/kilograms. \
Convert cups, sticks, ounces, pounds, fluid ounces, tablespoons and teaspoons. Temperatures in °C only — \
never Fahrenheit; convert and round sensibly (e.g. 350°F → 180°C).
- British spelling and terms throughout: "courgette" not "zucchini", "aubergine" not "eggplant", \
"coriander" (leaf) not "cilantro", "spring onion" not "scallion/green onion", "plain flour" not \
"all-purpose flour", "caster sugar"/"icing sugar" not "superfine/powdered sugar", "minced beef" not \
"ground beef", "prawns" not "shrimp", "rocket" not "arugula", "beetroot" not "beets", "swede" not \
"rutabaga", "grill" not "broil", "tin" not "can", "kitchen paper" not "paper towel". Use British \
spelling everywhere (e.g. "flavour", "colour").

## Fields
- title: clear, concise recipe name.
- description: 1–2 sentence summary, or null.
- servings: integer portions, or null if not stated.
- totalTimeMinutes/prepTimeMinutes/cookTimeMinutes: integers in minutes, or null.
- tags: short lowercase keywords (e.g. ["vegetarian","quick","pasta"]). Empty array if none.
- ingredientGroups: group ingredients by course/stage (null name = default group).
  Each ingredient: rawText (the ingredient line, already converted to metric + British spelling/terms — \
this is what the rest of the pipeline parses, so write a clean natural line e.g. "240ml whole milk" or \
"2 cloves garlic, crushed"), isOptional (true only if explicitly optional), firstUsedInStepOrdinal \
(0-based index into the steps array for the first step that uses this ingredient; null if none obvious).
- steps: numbered method steps. Each step: text (clear instruction, British terms, °C only), \
timerMinutes (integer or null), note (a genuine warning/non-obvious caveat only; null for routine steps).
- notes: the author's overall notes/tips, or null.

Extract only what is present on the page. Do not invent ingredients or steps. Ignore page navigation, \
ads, comments, and unrelated content.`;
