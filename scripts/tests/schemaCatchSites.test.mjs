/**
 * The characterization suite for `scripts/lib/schemaCatchSites.mjs` (issue #1251).
 *
 * The scanner is the judgement half of #1114's recurrence guard, and the guard
 * itself cannot characterise it: `schemaCatchGuard.test.mjs` runs over a tree
 * holding exactly two sanctioned call sites, so a scanner that found only those
 * two by luck — or a matcher quietly widened until it fired on prose — would sit
 * green there. So the shapes are fed in directly, the way
 * `scripts/lib/unitTestSpec.mjs`'s rule table does it: `CATCHES` are sources the
 * scanner MUST find a site in, with the symbol and field it must name; `MISSES`
 * are the near-misses it must not fire on at all.
 *
 * Every entry in `MISSES` contains the literal text `.catch(`, asserted below.
 * That is the anti-vacuity floor for this half: a "near-miss" that never
 * mentions `.catch(` proves nothing, and the old `.includes('.catch(')` scan
 * would have fired on every one of them.
 */

import { describe, expect, it } from 'vitest';

import { ANONYMOUS, catchSiteKey, findCatchSites } from '../lib/schemaCatchSites.mjs';

const FILE = 'sample.ts';

/** Sources with at least one Zod `.catch()`, and the sites they must produce. */
const CATCHES = [
  {
    what: 'a top-level export const chain',
    source: [
      "import { z } from 'zod';",
      '',
      'export const AuthoredRecipePhasesSchema = z',
      '  .array(RecipePhaseSchema)',
      '  .max(6)',
      '  .catch([]);',
    ].join('\n'),
    sites: [{ symbol: 'AuthoredRecipePhasesSchema', field: null, line: 6 }],
  },
  {
    what: 'a one-line enum with a string floor',
    source: "export const AuthoredRecipeKindSchema = z.enum(KINDS).catch('recipe');",
    sites: [{ symbol: 'AuthoredRecipeKindSchema', field: null, line: 1 }],
  },
  {
    what: 'a call on an object property — #1114’s own shape',
    source: [
      'export const ShoppingListItemSchema = z.object({',
      '  id: z.string(),',
      "  matchState: z.enum(['pending', 'matched']).catch('pending'),",
      '});',
    ].join('\n'),
    sites: [{ symbol: 'ShoppingListItemSchema', field: 'matchState', line: 3 }],
  },
  {
    what: 'a nested schema inside a z.object, reported by its full property path',
    source: [
      'export const RecipeSchema = z.object({',
      '  metadata: z.object({',
      '    servings: z.number().catch(0),',
      '  }),',
      '});',
    ].join('\n'),
    sites: [{ symbol: 'RecipeSchema', field: 'metadata.servings', line: 3 }],
  },
  {
    what: 'a non-exported helper — not exported is not exempt',
    source: 'const localFloor = z.string().catch("");',
    sites: [{ symbol: 'localFloor', field: null, line: 1 }],
  },
  {
    what: 'a schema built inside a named function',
    source: ['function buildSchema() {', '  return z.number().catch(0);', '}'].join('\n'),
    sites: [{ symbol: 'buildSchema', field: null, line: 2 }],
  },
  {
    what: "Zod's own callback form on a z chain — a handler argument is not enough to excuse it",
    source: 'export const Floor = z.array(z.string()).catch(() => []);',
    sites: [{ symbol: 'Floor', field: null, line: 1 }],
  },
  {
    what: 'a declaration with no name to attribute to',
    source: 'export default z.string().catch("");',
    sites: [{ symbol: ANONYMOUS, field: null, line: 1 }],
  },
  {
    what: 'two sites in one file, in source order',
    source: [
      'export const A = z.string().catch("a");',
      'export const B = z.object({ b: z.string().catch("b") });',
    ].join('\n'),
    sites: [
      { symbol: 'A', field: null, line: 1 },
      { symbol: 'B', field: 'b', line: 2 },
    ],
  },
];

/** Sources containing the text `.catch(` that must produce no site at all. */
const MISSES = [
  {
    what: 'a Promise .catch(err => …)',
    source: 'const rows = await loadRows().catch((err) => []);',
  },
  {
    what: 'a Promise .catch() with no argument',
    source: 'void flushQueue().catch();',
  },
  {
    what: 'a .catch() discussed in a block comment',
    source: [
      '/**',
      ' * `matchState` deliberately carries no `.catch(` — see #1114.',
      ' */',
      'export const ShoppingListItemSchema = z.object({ id: z.string() });',
    ].join('\n'),
  },
  {
    what: 'a .catch() mentioned in a line comment',
    source: ['// Never add .catch(null) to this field.', 'export const S = z.string();'].join('\n'),
  },
  {
    what: 'a .catch( inside a string literal',
    source: "export const advice = 'reach for .catch(value) only on an AI output';",
  },
];

describe('findCatchSites', () => {
  it.each(CATCHES)('finds $what', ({ source, sites }) => {
    expect(findCatchSites(source, FILE)).toEqual(
      sites.map((site) => ({
        file: FILE,
        symbol: site.symbol,
        field: site.field,
        line: site.line,
        key: catchSiteKey({ file: FILE, symbol: site.symbol, field: site.field }),
      })),
    );
  });

  it.each(MISSES)('does not fire on $what', ({ source }) => {
    expect(findCatchSites(source, FILE)).toEqual([]);
  });

  it('has near-misses that are near', () => {
    // Anti-vacuity: each MISS must be something the old text scan WOULD have
    // fired on, or it is not testing the narrowing at all.
    for (const { what, source } of MISSES) {
      expect(`${what}: ${source}`).toContain('.catch(');
    }
  });
});

describe('catchSiteKey', () => {
  it('keys a bare symbol and a field-qualified one apart', () => {
    expect(catchSiteKey({ file: 'recipe.ts', symbol: 'RecipeSchema', field: null })).toBe(
      'recipe.ts#RecipeSchema',
    );
    expect(
      catchSiteKey({ file: 'recipe.ts', symbol: 'RecipeSchema', field: 'metadata.servings' }),
    ).toBe('recipe.ts#RecipeSchema.metadata.servings');
  });
});
