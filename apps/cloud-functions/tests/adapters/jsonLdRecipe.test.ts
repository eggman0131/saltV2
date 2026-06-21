import { describe, it, expect } from 'vitest';
import { extractRecipeJsonLd } from '../../src/adapters/jsonLdRecipe.js';

// Helper to wrap a JSON-LD payload in a script block inside a minimal page.
function page(...jsonLdBlocks: string[]): string {
  const scripts = jsonLdBlocks
    .map((b) => `<script type="application/ld+json">${b}</script>`)
    .join('\n');
  return `<!doctype html><html><head>${scripts}</head><body>...</body></html>`;
}

const RECIPE = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Test Pancakes',
  description: 'Fluffy American pancakes.',
  recipeYield: '4 servings',
  prepTime: 'PT10M',
  cookTime: 'PT15M',
  totalTime: 'PT25M',
  keywords: 'breakfast, easy',
  recipeCategory: 'Breakfast',
  recipeIngredient: ['2 cups all-purpose flour', '1 cup milk', '2 eggs'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Mix the dry ingredients.' },
    { '@type': 'HowToStep', text: 'Whisk in the wet ingredients.' },
    { '@type': 'HowToStep', text: 'Cook on a hot pan.' },
  ],
};

describe('extractRecipeJsonLd', () => {
  it('extracts a top-level Recipe node', () => {
    const recipe = extractRecipeJsonLd(page(JSON.stringify(RECIPE)));
    expect(recipe).not.toBeNull();
    expect(recipe?.title).toBe('Test Pancakes');
    expect(recipe?.description).toBe('Fluffy American pancakes.');
    expect(recipe?.servings).toBe(4);
    expect(recipe?.prepTimeMinutes).toBe(10);
    expect(recipe?.cookTimeMinutes).toBe(15);
    expect(recipe?.totalTimeMinutes).toBe(25);
    expect(recipe?.ingredients).toEqual(['2 cups all-purpose flour', '1 cup milk', '2 eggs']);
    expect(recipe?.steps).toEqual([
      'Mix the dry ingredients.',
      'Whisk in the wet ingredients.',
      'Cook on a hot pan.',
    ]);
    expect(recipe?.tags).toContain('breakfast');
    expect(recipe?.tags).toContain('easy');
  });

  it('finds a Recipe inside an @graph array', () => {
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'A blog' },
        { '@type': 'Organization', name: 'Publisher' },
        RECIPE,
      ],
    };
    const recipe = extractRecipeJsonLd(page(JSON.stringify(graph)));
    expect(recipe?.title).toBe('Test Pancakes');
    expect(recipe?.ingredients).toHaveLength(3);
  });

  it('handles a Recipe whose @type is an array', () => {
    const multi = { ...RECIPE, '@type': ['Recipe', 'NewsArticle'] };
    const recipe = extractRecipeJsonLd(page(JSON.stringify(multi)));
    expect(recipe?.title).toBe('Test Pancakes');
  });

  it('scans multiple script blocks and skips the non-recipe ones', () => {
    const html = page(
      JSON.stringify({ '@type': 'BreadcrumbList', itemListElement: [] }),
      JSON.stringify(RECIPE),
    );
    const recipe = extractRecipeJsonLd(html);
    expect(recipe?.title).toBe('Test Pancakes');
  });

  it('skips a malformed JSON block without throwing and finds the valid one', () => {
    const html = page('{ this is not valid json ]', JSON.stringify(RECIPE));
    const recipe = extractRecipeJsonLd(html);
    expect(recipe?.title).toBe('Test Pancakes');
  });

  it('returns null when there is no Recipe JSON-LD', () => {
    const html = page(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: 'News',
      }),
    );
    expect(extractRecipeJsonLd(html)).toBeNull();
  });

  it('returns null when there are no JSON-LD blocks at all', () => {
    expect(extractRecipeJsonLd('<html><body><h1>Just a page</h1></body></html>')).toBeNull();
  });

  it('rejects a Recipe node with no ingredients (too thin to trust)', () => {
    const thin = { '@type': 'Recipe', name: 'Empty', recipeIngredient: [] };
    expect(extractRecipeJsonLd(page(JSON.stringify(thin)))).toBeNull();
  });

  it('flattens HowToSection instructions into a flat list of steps', () => {
    const sectioned = {
      ...RECIPE,
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'Batter',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Combine flour and milk.' },
            { '@type': 'HowToStep', text: 'Rest the batter.' },
          ],
        },
        { '@type': 'HowToStep', text: 'Fry.' },
      ],
    };
    const recipe = extractRecipeJsonLd(page(JSON.stringify(sectioned)));
    expect(recipe?.steps).toEqual(['Combine flour and milk.', 'Rest the batter.', 'Fry.']);
  });

  it('accepts plain-string instructions', () => {
    const stringy = {
      ...RECIPE,
      recipeInstructions: 'Mix everything. Cook it. Serve.',
    };
    const recipe = extractRecipeJsonLd(page(JSON.stringify(stringy)));
    expect(recipe?.steps).toEqual(['Mix everything. Cook it. Serve.']);
  });

  it('parses keywords given as an array', () => {
    const arrKeywords = { ...RECIPE, keywords: ['vegan', 'quick'] };
    const recipe = extractRecipeJsonLd(page(JSON.stringify(arrKeywords)));
    expect(recipe?.tags).toEqual(expect.arrayContaining(['vegan', 'quick']));
  });

  it('coerces a numeric recipeYield', () => {
    const numYield = { ...RECIPE, recipeYield: 6 };
    const recipe = extractRecipeJsonLd(page(JSON.stringify(numYield)));
    expect(recipe?.servings).toBe(6);
  });

  it('handles script tags with extra attributes and reversed attribute order', () => {
    const html = `<script class="yoast" data-x="1" type='application/ld+json'>${JSON.stringify(
      RECIPE,
    )}</script>`;
    const recipe = extractRecipeJsonLd(html);
    expect(recipe?.title).toBe('Test Pancakes');
  });
});
