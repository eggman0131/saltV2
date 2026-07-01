import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { isHttpsScheme, parseImportUrl } from '@salt/domain';
import { ExtractRecipeFromUrlInputSchema, ExtractRecipeAIOutputSchema } from '@salt/domain/schemas';
import type { ExtractRecipeAIOutput, UrlImportFailureCode } from '@salt/domain/schemas';
import type { RecipeDoc, IngredientGroupDoc } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { ssrfGuardedFetch, SsrfFetchError } from '../adapters/ssrfFetch.js';
import { extractRecipeJsonLd, type JsonLdRecipe } from '../adapters/jsonLdRecipe.js';
import { canonicaliseRecipeIngredientsFlow } from './canonicaliseRecipeIngredients.js';
import { parseRecipeIngredientsFlow } from './parseRecipeIngredients.js';
import { resolveModel } from '../ai/resolveModel.js';
import { CATEGORY_TAG_RULES } from './categoryTags.js';

// SSRF-hardened URL import (recipe URL import epic, Phases 1 & 3).
//
// Pipeline: validate URL → SSRF-guarded fetch (raw HTML) → prefer schema.org/
// Recipe JSON-LD parsed straight from the page (Phase 3) and feed its structured
// fields to Gemini for unit/spelling conversion; otherwise fall back to handing
// the cleaned HTML to Gemini to both find AND convert the recipe → reuse parse/
// canonicalise flows for ingredient matching → assemble a RecipeDoc draft with
// source.type='url'.
//
// The flow throws a UrlImportError tagged with a failure code; the onCall
// entrypoint maps each code to the right HttpsError + user-facing copy.

// When no JSON-LD Recipe is present we forward the raw page HTML to the model.
// Cap it so a huge page can't blow the prompt budget; recipes always appear well
// within the first chunk.
const MAX_HTML_CHARS = 200_000;

// How much AI-extracted content counts as "rich enough" to be a real recipe when
// the page carried NO JSON-LD Recipe. With JSON-LD absent AND the model returning
// barely anything, we treat the page as not-a-recipe rather than a thin draft.
const MIN_INGREDIENTS_NO_JSON_LD = 2;
const MIN_STEPS_NO_JSON_LD = 1;

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

    // Human-readable top-level span name for the end-to-end trace view. The flow
    // span is the active span inside an ai.defineFlow body; setActiveSpanName
    // renames it (caps at 80 chars, no-op when no span is active). The host is the
    // scannable identifier — never the full URL (path/query are noise here).
    setActiveSpanName(`Import recipe from ${parsed.hostname}`);

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

    // 3. Prefer schema.org/Recipe JSON-LD if the page embeds it (Phase 3). It is
    //    untrusted input from an arbitrary page, so jsonLdRecipe validates every
    //    block with Zod (safeParse) before returning a normalised recipe. A hit
    //    gives us reliable structure; the model still converts units + spelling.
    const jsonLd = extractRecipeJsonLd(html);

    // 4. Gemini extraction + metric/British conversion. When we have JSON-LD we
    //    feed the model the already-structured fields to CONVERT (not to hunt for
    //    a recipe inside HTML); otherwise we fall back to handing it the page HTML
    //    to both find and convert the recipe.
    const { system, prompt } = jsonLd
      ? buildJsonLdPrompt(jsonLd, parsed.href)
      : buildHtmlPrompt(html, parsed.href);

    // Flash + temperature:0 — accuracy over creativity, mirrors the librarian flow.
    const extractModelId = await resolveModel('fast', 'extractRecipeFromUrl');
    const extractModel = googleAI.model(extractModelId);
    let extracted: ExtractRecipeAIOutput;
    try {
      extracted = await withAiTimeout(
        'extractRecipeFromUrl',
        async () => {
          const result = await ai.generate({
            model: extractModel,
            system,
            prompt,
            output: { schema: ExtractRecipeAIOutputSchema },
            config: { temperature: 0 },
          });
          // Validate INSIDE the retried op: an empty/malformed structured
          // response (Gemini occasionally returns one even at temperature:0, and
          // structured-output coercion can fail transiently) then gets a fresh
          // attempt rather than failing the whole import on a single flaky
          // generation. Only a persistent failure surfaces as ai-failed.
          const validated = ExtractRecipeAIOutputSchema.safeParse(result.output);
          if (!validated.success) {
            throw new Error(`extractor returned invalid structure: ${validated.error.message}`);
          }
          return validated.data;
        },
        { timeoutMs: 40_000, retries: 1 },
      );
    } catch (err) {
      // AI timeout / transport / model error / invalid output all surface as
      // ai-failed after the retry is exhausted.
      throw new UrlImportError('ai-failed', err instanceof Error ? err.message : 'ai error');
    }

    // 5. Did we actually find a recipe? JSON-LD is a strong positive signal: a
    //    validated schema.org/Recipe with ingredients means the page IS a recipe,
    //    so we only require the model to have emitted ingredient groups. With NO
    //    JSON-LD we lean on the model's own isRecipe flag PLUS content richness —
    //    a page with no JSON-LD Recipe and barely any extracted content is treated
    //    as not-a-recipe (same failure code, stronger signal).
    if (!hasUsableRecipe(extracted, jsonLd !== null)) {
      throw new UrlImportError('not-a-recipe', 'no recipe found on page');
    }

    // 6. Assemble the draft (reuses parse + canonicalise flows).
    return assembleDraft(extracted, parsed.href);
  },
);

// Tighten the not-a-recipe decision now that JSON-LD gives a stronger signal.
// - hadJsonLd: a validated schema.org/Recipe was present on the page. That alone
//   is strong evidence the page IS a recipe, so we accept as long as the model
//   produced at least one ingredient.
// - no JSON-LD: fall back to the model's own isRecipe flag AND require the
//   extracted content to be more than trivially thin (a stray ingredient list in
//   a blog post shouldn't pass as a recipe). This keeps the failure taxonomy
//   intact — it only fires not-a-recipe on a stronger combined signal.
function hasUsableRecipe(extracted: ExtractRecipeAIOutput, hadJsonLd: boolean): boolean {
  // A recipe with no title is a broken extraction — never assemble an untitled
  // draft. Checked here (not at the schema) so an isRecipe=false response, which
  // legitimately leaves the title empty, still maps to not-a-recipe rather than
  // ai-failed.
  if (extracted.title.trim().length === 0) {
    return false;
  }
  const ingredientCount = extracted.ingredientGroups.reduce(
    (sum, g) => sum + g.ingredients.length,
    0,
  );
  if (hadJsonLd) {
    return ingredientCount > 0;
  }
  return (
    extracted.isRecipe &&
    ingredientCount >= MIN_INGREDIENTS_NO_JSON_LD &&
    extracted.steps.length >= MIN_STEPS_NO_JSON_LD
  );
}

// Build the prompt for the JSON-LD path: hand the model the already-structured
// recipe so it converts units → metric and names/spelling → British WITHOUT
// having to locate the recipe inside noisy HTML. isRecipe is effectively given.
function buildJsonLdPrompt(
  recipe: JsonLdRecipe,
  sourceUrl: string,
): {
  system: string;
  prompt: string;
} {
  const lines: string[] = [];
  lines.push(`Title: ${recipe.title}`);
  if (recipe.description !== null) lines.push(`Description: ${recipe.description}`);
  if (recipe.servings !== null) lines.push(`Servings: ${recipe.servings}`);
  if (recipe.totalTimeMinutes !== null)
    lines.push(`Total time (minutes): ${recipe.totalTimeMinutes}`);
  if (recipe.prepTimeMinutes !== null) lines.push(`Prep time (minutes): ${recipe.prepTimeMinutes}`);
  if (recipe.cookTimeMinutes !== null) lines.push(`Cook time (minutes): ${recipe.cookTimeMinutes}`);
  if (recipe.tags.length > 0) lines.push(`Keywords: ${recipe.tags.join(', ')}`);
  lines.push('');
  lines.push('Ingredients:');
  for (const ing of recipe.ingredients) lines.push(`- ${ing}`);
  lines.push('');
  lines.push('Method:');
  recipe.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));

  return {
    system: EXTRACT_SYSTEM_JSON_LD,
    prompt: `Source URL: ${sourceUrl}\n\nStructured recipe data (schema.org/Recipe):\n${lines.join('\n')}`,
  };
}

// Strip the parts of a page that carry no recipe signal but burn tokens before
// we forward HTML to the model: <script> (often hundreds of KB of bundles),
// <style>, <head>, <noscript>, <template>, <svg> (icon paths), HTML comments,
// and inline base64 `data:` URIs (which can each be tens of KB). A recipe page's
// actual content survives intact. This runs on the fallback path only — most
// mainstream sites carry JSON-LD and never reach here. Dependency-free regex,
// consistent with jsonLdRecipe (no cheerio/jsdom — issue-gated).
function stripHtmlNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript[^>]*>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template[^>]*>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg[^>]*>/gi, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head[^>]*>/gi, ' ')
    .replace(/\bsrc\s*=\s*["']data:[^"']*["']/gi, 'src=""')
    .replace(/[ \t\f\v]{2,}/g, ' ')
    .replace(/(\s*\n\s*){2,}/g, '\n');
}

// Build the prompt for the HTML fallback path (no JSON-LD found): the model both
// finds the recipe in the page and converts it. We strip script/style/svg noise
// FIRST, then cap — so the budget is spent on real content, not bundles.
function buildHtmlPrompt(html: string, sourceUrl: string): { system: string; prompt: string } {
  const cleaned = stripHtmlNoise(html);
  const trimmedHtml = cleaned.length > MAX_HTML_CHARS ? cleaned.slice(0, MAX_HTML_CHARS) : cleaned;
  return {
    system: EXTRACT_SYSTEM,
    prompt: `Source URL: ${sourceUrl}\n\nPage HTML:\n${trimmedHtml}`,
  };
}

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
      // Derive a total from prep + cook when the source only gives the parts
      // (common — e.g. the page states prep and cook but no explicit total), so
      // the editor shows a total time instead of a blank.
      totalTimeMinutes:
        raw.totalTimeMinutes ??
        (raw.prepTimeMinutes !== null && raw.cookTimeMinutes !== null
          ? raw.prepTimeMinutes + raw.cookTimeMinutes
          : null),
      prepTimeMinutes: raw.prepTimeMinutes,
      cookTimeMinutes: raw.cookTimeMinutes,
      // Split comma-joined tags ("vegetarian, quick" → two tags) before
      // kebab-normalising, then dedupe.
      tags: [
        ...new Set(
          raw.tags
            .flatMap((t) => t.split(','))
            .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
            .filter((t) => t.length > 0),
        ),
      ],
    },
    source: { type: 'url', url: sourceUrl },
    notes: raw.notes,
    image: null,
    createdAt: now,
    updatedAt: now,
  };
}

// Shared conversion + field rules, reused by both the HTML-fallback prompt and
// the JSON-LD prompt so unit/spelling conversion can't drift between the paths.
const CONVERSION_RULES = `## Conversion rules (apply to EVERYTHING)
- Metric only: convert all quantities to metric. Volumes in millilitres/litres, weights in grams/kilograms. \
Convert cups, sticks, ounces, pounds, fluid ounces, tablespoons and teaspoons. Temperatures in °C only — \
never Fahrenheit; convert and round sensibly (e.g. 350°F → 180°C).
- British spelling and terms throughout. Always translate American ingredient names and terms to British:
  - cilantro (leaf) → coriander
  - eggplant → aubergine
  - zucchini → courgette
  - scallion / green onion → spring onion
  - arugula → rocket
  - shrimp → prawns
  - ground beef → beef mince (likewise ground pork/lamb → pork/lamb mince)
  - all-purpose flour → plain flour
  - self-rising flour → self-raising flour
  - confectioners' / powdered sugar → icing sugar
  - superfine sugar → caster sugar
  - granulated sugar → caster sugar (unless it must stay granulated)
  - light/dark brown sugar → light/dark soft brown sugar
  - heavy cream → double cream; half-and-half / light cream → single cream
  - whole milk stays whole milk; "milk" stays milk
  - beets → beetroot
  - rutabaga → swede
  - snow peas → mangetout
  - bell pepper → pepper (e.g. red pepper)
  - chickpeas / garbanzo beans → chickpeas
  - cornstarch → cornflour
  - molasses → treacle (black treacle for blackstrap)
  - golden raisins → sultanas
  - baking soda → bicarbonate of soda
  - shredded/desiccated coconut → desiccated coconut
  - jelly → jam; jello → jelly
  - skillet → frying pan; broil → grill; can → tin
  - paper towel → kitchen paper; plastic wrap → cling film; parchment paper → baking paper
- Use British spelling everywhere (e.g. "flavour", "colour", "caramelise").`;

const FIELD_RULES = `## Fields
- title: clear, concise recipe name.
- description: 1–2 sentence summary, or null.
- servings: integer portions, or null if not stated.
- totalTimeMinutes/prepTimeMinutes/cookTimeMinutes: integers in minutes, or null.
${CATEGORY_TAG_RULES}
- ingredientGroups: group ingredients by course/stage (null name = default group).
  Each ingredient: rawText (the ingredient line, already converted to metric + British spelling/terms — \
this is what the rest of the pipeline parses, so write a clean natural line e.g. "240ml whole milk" or \
"2 cloves garlic, crushed"), isOptional (true only if explicitly optional), firstUsedInStepOrdinal \
(0-based index into the steps array for the first step that uses this ingredient; null if none obvious).
- steps: numbered method steps. Each step: text (clear instruction, British terms, °C only), \
timerMinutes (integer or null), note (a genuine warning/non-obvious caveat only; null for routine steps).
- notes: the author's overall notes/tips, or null.`;

const EXTRACT_SYSTEM = `You are a precise recipe extraction assistant. You are given the raw HTML \
of a web page and its source URL. Extract a single complete recipe from the page and convert it \
fully to UK conventions.

## Is it a recipe?
- Set isRecipe=false (and leave the other fields at sensible empties) ONLY when the page contains no \
cooking recipe at all (e.g. a news article, a product listing, a 404). If a recipe is present, \
isRecipe=true.

${CONVERSION_RULES}

${FIELD_RULES}

Extract only what is present on the page. Do not invent ingredients or steps. Ignore page navigation, \
ads, comments, and unrelated content.`;

// JSON-LD path: the recipe has already been located and structured for us by the
// page's schema.org/Recipe data, so the model's job is conversion + tidy-up, not
// hunting through HTML. isRecipe is therefore true.
const EXTRACT_SYSTEM_JSON_LD = `You are a precise recipe extraction assistant. You are given a single \
recipe already extracted as structured schema.org/Recipe data (title, ingredients, method, times). \
Your job is to faithfully convert it to UK conventions and return it in the required shape. The input \
is genuine recipe data, so set isRecipe=true.

## Faithfulness
- Use ONLY the ingredients, steps, times and servings given. Do not invent, add, drop or reorder \
content. Keep every ingredient and every method step. Preserve any ingredient groupings/headings if \
present in the data.

${CONVERSION_RULES}

${FIELD_RULES}`;
