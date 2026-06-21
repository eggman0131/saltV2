import { z } from 'genkit';

// schema.org/Recipe JSON-LD extraction (recipe URL import epic, Phase 3).
//
// Many mainstream recipe sites embed a machine-readable recipe as
// `<script type="application/ld+json">…</script>`. When present this is far more
// reliable than scraping rendered HTML: the structure (ingredients, steps,
// times, yield) is already separated for us. We still hand the *content* to
// Gemini afterwards so it can convert units to metric and ingredient
// names/spelling to British — JSON-LD gives structure, the model converts.
//
// This is UNTRUSTED input from an arbitrary page (a trust boundary): the script
// block can contain anything. We extract candidate blocks with a dependency-free
// regex (no cheerio/jsdom — issue-gated), `JSON.parse` each one defensively, and
// validate the shape with Zod (`safeParse`). Anything that doesn't look like a
// Recipe is discarded.

// schema.org allows several shapes for the same field. These permissive coercers
// flatten them to the simple forms the rest of the pipeline wants.

// A schema.org text value can be a bare string, a {@value}/{name} object, or an
// array of those. Collapse to a single trimmed string (first non-empty).
function coerceText(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = coerceText(v);
      if (t !== null) return t;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return coerceText(obj['@value'] ?? obj['name'] ?? obj['text']);
  }
  return null;
}

// A list of texts (ingredients, instruction strings). schema.org instructions
// can be plain strings, HowToStep objects ({text}), or HowToSection objects
// ({itemListElement:[…]}). Flatten recursively to clean strings.
function coerceTextList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) push(item);
      return;
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      // HowToSection → recurse into its steps.
      if (obj['itemListElement'] !== undefined) {
        push(obj['itemListElement']);
        return;
      }
      const t = coerceText(obj['text'] ?? obj['name'] ?? obj['@value']);
      if (t !== null) out.push(t);
      return;
    }
    const t = coerceText(v);
    if (t !== null) out.push(t);
  };
  push(value);
  return out;
}

// recipeYield can be "4", "4 servings", ["4","4 servings"], or a number.
function coerceServings(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : coerceText(value);
  if (text === null) return null;
  const match = /\d+/.exec(text);
  if (match === null) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ISO-8601 durations (PT1H30M) → minutes. schema.org uses these for prep/cook/
// total times. Returns null for anything we can't parse.
function coerceDurationMinutes(value: unknown): number | null {
  const text = coerceText(value);
  if (text === null) return null;
  // PnDTnHnMnS — we only care about D/H/M (time-side M = minutes).
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text.trim());
  if (match === null) return null;
  const days = match[1] ? Number.parseInt(match[1], 10) : 0;
  const hours = match[2] ? Number.parseInt(match[2], 10) : 0;
  const mins = match[3] ? Number.parseInt(match[3], 10) : 0;
  const total = days * 24 * 60 + hours * 60 + mins;
  return total > 0 ? total : null;
}

// The normalized, pipeline-friendly shape we hand back to the flow. All fields
// are already collapsed from schema.org's many representations.
export interface JsonLdRecipe {
  readonly title: string;
  readonly description: string | null;
  readonly servings: number | null;
  readonly totalTimeMinutes: number | null;
  readonly prepTimeMinutes: number | null;
  readonly cookTimeMinutes: number | null;
  readonly tags: string[];
  readonly ingredients: string[];
  readonly steps: string[];
}

// A permissive Zod schema for the RAW schema.org Recipe node. We only assert the
// minimum we need to trust it; every field is optional + unknown because the page
// author controls the shape. This is the trust-boundary validation required by
// CLAUDE.md for untrusted parsed input.
const RawJsonLdRecipeSchema = z
  .object({
    '@type': z.unknown(),
    name: z.unknown().optional(),
    headline: z.unknown().optional(),
    description: z.unknown().optional(),
    recipeYield: z.unknown().optional(),
    yield: z.unknown().optional(),
    totalTime: z.unknown().optional(),
    prepTime: z.unknown().optional(),
    cookTime: z.unknown().optional(),
    keywords: z.unknown().optional(),
    recipeCategory: z.unknown().optional(),
    recipeCuisine: z.unknown().optional(),
    recipeIngredient: z.unknown().optional(),
    ingredients: z.unknown().optional(),
    recipeInstructions: z.unknown().optional(),
  })
  .passthrough();

// Does an @type (string or array) include "Recipe"?
function isRecipeType(typeValue: unknown): boolean {
  if (typeof typeValue === 'string') return typeValue.toLowerCase() === 'recipe';
  if (Array.isArray(typeValue)) {
    return typeValue.some((t) => typeof t === 'string' && t.toLowerCase() === 'recipe');
  }
  return false;
}

// keywords can be a comma-joined string or an array. recipeCategory/Cuisine are
// single useful tags. Normalize to a deduped list of trimmed strings.
function coerceTags(node: Record<string, unknown>): string[] {
  const tags: string[] = [];
  const kw = node['keywords'];
  if (typeof kw === 'string') {
    for (const part of kw.split(',')) {
      const t = part.trim();
      if (t.length > 0) tags.push(t);
    }
  } else {
    tags.push(...coerceTextList(kw));
  }
  tags.push(...coerceTextList(node['recipeCategory']));
  tags.push(...coerceTextList(node['recipeCuisine']));
  const seen = new Set<string>();
  return tags.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Convert one validated raw schema.org node into our normalized shape, or null
// if it lacks the bare minimum (a title and at least one ingredient).
function normalizeRecipeNode(raw: z.infer<typeof RawJsonLdRecipeSchema>): JsonLdRecipe | null {
  const node = raw as Record<string, unknown>;
  const title = coerceText(node['name'] ?? node['headline']);
  const ingredients = coerceTextList(node['recipeIngredient'] ?? node['ingredients']);
  const steps = coerceTextList(node['recipeInstructions']);
  // Require a title, at least one ingredient, AND at least one step. An
  // ingredient-only stub (some sites emit a Recipe node with no instructions)
  // isn't a usable recipe — fall through so the HTML path or not-a-recipe can
  // take over rather than feeding the model a recipe with no method.
  if (title === null || ingredients.length === 0 || steps.length === 0) return null;

  return {
    title,
    description: coerceText(node['description']),
    servings: coerceServings(node['recipeYield'] ?? node['yield']),
    totalTimeMinutes: coerceDurationMinutes(node['totalTime']),
    prepTimeMinutes: coerceDurationMinutes(node['prepTime']),
    cookTimeMinutes: coerceDurationMinutes(node['cookTime']),
    tags: coerceTags(node),
    ingredients,
    steps,
  };
}

// Walk an arbitrary parsed JSON-LD value (object, array, or @graph container)
// and collect every Recipe node found. Recurses into @graph and nested arrays.
function collectRecipeNodes(parsed: unknown, out: JsonLdRecipe[]): void {
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectRecipeNodes(item, out);
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  const obj = parsed as Record<string, unknown>;

  // @graph holds the real list of entities on many sites.
  if (Array.isArray(obj['@graph'])) {
    collectRecipeNodes(obj['@graph'], out);
  }

  if (isRecipeType(obj['@type'])) {
    const validated = RawJsonLdRecipeSchema.safeParse(obj);
    if (validated.success) {
      const normalized = normalizeRecipeNode(validated.data);
      if (normalized !== null) out.push(normalized);
    }
  }
}

// Pull every `<script type="application/ld+json">…</script>` block's INNER text
// out of an HTML string with a dependency-free regex. Handles attribute order,
// single/double quotes, extra attributes, and whitespace. Returns raw JSON
// strings (not yet parsed).
function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re =
    /<script\b[^>]*\btype\s*=\s*['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const body = match[1];
    if (body !== undefined && body.trim().length > 0) blocks.push(body);
  }
  return blocks;
}

// Extract the first usable schema.org/Recipe from a page's HTML, or null if the
// page has no parseable JSON-LD Recipe. Malformed JSON in one block never throws
// — it's skipped and we move on to the next block.
export function extractRecipeJsonLd(html: string): JsonLdRecipe | null {
  const recipes: JsonLdRecipe[] = [];
  for (const block of extractJsonLdBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      // A page may have invalid JSON-LD; skip and keep looking.
      continue;
    }
    collectRecipeNodes(parsed, recipes);
    if (recipes.length > 0) return recipes[0]!;
  }
  return null;
}
