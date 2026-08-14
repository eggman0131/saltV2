import { describe, it, expect } from 'vitest';
import { resolveProductForm } from '@salt/domain';
import type { ProductForm } from '@salt/domain';

// A form is identified by its label AND its matchers, both folded with canon's
// normaliseName and matched on whole-token boundaries (issue #818).

function form(
  id: string,
  label: string,
  matchers: readonly string[],
  parentCanonId = `parent-${id}`,
): ProductForm {
  return {
    id,
    schemaVersion: 1,
    matchers,
    parentCanonId,
    label,
    yield: { formUnit: 'count', amountPerParent: 2 },
    updatedAt: '',
  };
}

describe('resolveProductForm — the label is matching input', () => {
  it('matches a form whose label alone spells the ingredient', () => {
    // The live "Chicken Legs" shape: five matchers, none of them "chicken legs".
    const legs = form('legs', 'Chicken Legs', [
      'chicken thigh',
      'chicken thighs',
      'dark meat',
      'drumstick',
      'chicken drumsticks',
    ]);
    expect(resolveProductForm('Chicken legs', [legs])?.id).toBe('legs');
  });

  it('matches a form whose only matcher is worded the other way round', () => {
    // The live "Lemon zest" shape: matcher "zest of lemon", label "Lemon zest".
    const zest = form('zest', 'Lemon zest', ['zest of lemon']);
    expect(resolveProductForm('lemon zest', [zest])?.id).toBe('zest');
    expect(resolveProductForm('zest of lemon', [zest])?.id).toBe('zest');
  });

  it('still matches on the matchers when the label does not fit', () => {
    const legs = form('legs', 'Chicken Legs', ['dark meat']);
    expect(resolveProductForm('500 g dark meat', [legs])?.id).toBe('legs');
  });

  it('lets the label and the matchers compete, longest phrase winning', () => {
    const juice = form('juice', 'Lime juice', ['juice']);
    const posset = form('posset', 'juice', ['fresh lime juice for posset']);
    // "lime juice" (the label, 10 chars) beats "juice" (5) on both forms.
    expect(resolveProductForm('lime juice', [juice, posset])?.id).toBe('juice');
  });

  it('measures longest-wins on the NORMALISED phrase, not the raw one', () => {
    // Raw: "2 chicken thighs" (16) is longer than "chicken breast" (14), but it
    // normalises to "chicken thigh" (13), so the breast form wins the tie-break.
    const thigh = form('thigh', 'Thighs', ['2 chicken thighs']);
    const breast = form('breast', 'chicken breast', []);
    expect(resolveProductForm('chicken thigh and chicken breast', [thigh, breast])?.id).toBe(
      'breast',
    );
  });
});

describe('resolveProductForm — plurals and quantities fold away', () => {
  const breast = form('breast', 'chicken breast', ['chicken breasts']);

  it('binds a singular ingredient to a plural phrase', () => {
    // The reported 2026-08-14 defect: this minted an orphan `Chicken Breast`.
    expect(resolveProductForm('chicken breast', [breast])?.id).toBe('breast');
  });

  it('binds a plural ingredient to a singular phrase', () => {
    const single = form('single', 'chicken breast', []);
    expect(resolveProductForm('chicken breasts', [single])?.id).toBe('single');
  });

  it('binds identically with a quantity prefix', () => {
    for (const text of ['chicken breast', 'chicken breasts', '2 chicken breasts']) {
      expect(resolveProductForm(text, [breast])?.id).toBe('breast');
    }
  });

  it('folds punctuation, accents and case', () => {
    const puree = form('puree', 'Tomato purée', []);
    expect(resolveProductForm('2 tbsp TOMATO PUREE, from a tube', [puree])?.id).toBe('puree');
  });

  it('handles two phrases that normalise to the same string', () => {
    const dupe = form('dupe', 'Chicken Breasts', ['chicken breast']);
    // Both phrases fold to "chicken breast"; the result stays deterministic.
    expect(resolveProductForm('chicken breast', [dupe])?.id).toBe('dupe');
  });
});

describe('resolveProductForm — matching is token-aligned', () => {
  const oat = form('oat', 'oat', []);
  const pea = form('pea', 'pea', []);

  it('matches a phrase that occupies whole words', () => {
    expect(resolveProductForm('rolled oats', [oat])?.id).toBe('oat');
    expect(resolveProductForm('frozen peas', [pea])?.id).toBe('pea');
  });

  it('does not match inside the middle of a word', () => {
    expect(resolveProductForm('goat cheese', [oat])).toBeNull();
    expect(resolveProductForm('peanut butter', [pea])).toBeNull();
  });

  it('does not match a phrase straddling a word boundary', () => {
    const nut = form('nut', 'nut butter', []);
    expect(resolveProductForm('peanut butter', [nut])).toBeNull();
  });
});

describe('resolveProductForm — empty and degenerate input', () => {
  const breast = form('breast', 'chicken breast', ['chicken breasts']);

  it('returns null for empty and whitespace-only ingredient text', () => {
    expect(resolveProductForm('', [breast])).toBeNull();
    expect(resolveProductForm('   ', [breast])).toBeNull();
  });

  it('returns null when the ingredient normalises away to nothing', () => {
    // normaliseName strips pure-digit, word-number and digit-prefixed tokens.
    expect(resolveProductForm('2', [breast])).toBeNull();
    expect(resolveProductForm('three 400g', [breast])).toBeNull();
    expect(resolveProductForm('!!!', [breast])).toBeNull();
  });

  it('skips phrases that normalise away to nothing', () => {
    const junk = form('junk', '12', ['   ', '!!!', 'two']);
    expect(resolveProductForm('12 two', [junk])).toBeNull();
    expect(resolveProductForm('anything at all', [junk])).toBeNull();
  });

  it('returns null against an empty table', () => {
    expect(resolveProductForm('chicken breast', [])).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(resolveProductForm('plain flour', [breast])).toBeNull();
  });
});

// Regression guard over the live product-form table. Read from the staging
// database on 2026-08-14 (refreshed wholesale from production on 2026-08-07),
// plus the `["juice"]` → Lime form quoted verbatim in issue #818, which post-
// dates that refresh. Ids and text are reproduced exactly as stored.
describe('resolveProductForm — live production forms', () => {
  const LEMON = 'c74c2ef0-1660-4f6a-8902-ac23c6cc31ce';
  const CHICKEN = '0288c51e-043e-4d5c-8d75-24007fc85d08';
  const BEEF = 'aa65d8cc-8f51-4721-9b40-bb8eb695e0e6';
  const OLIVE = '11f808fd-3b0c-4483-928a-c7e9c8e40432';
  const LIME = 'a5a5cfd2-lime';

  const live: ProductForm[] = [
    form('0e6a6a45', 'Fresh lemon juice', ['fresh lemon juice'], LEMON),
    form('33ac24ec', 'Beef Stock', ['beef stock'], BEEF),
    form('4256c30b', 'chicken breast', ['chicken breasts'], CHICKEN),
    form('504fbbe1', 'Lemon zest', ['zest of lemon'], LEMON),
    form('811ab961', 'Chicken carcass', ['roast chicken carcass', 'chicken carcass'], CHICKEN),
    form('a926262a', 'Olive oil from jar', ['oil from the olive jar'], OLIVE),
    form(
      'fb35624f',
      'Chicken Legs',
      ['chicken thigh', 'chicken thighs', 'dark meat', 'drumstick', 'chicken drumsticks'],
      CHICKEN,
    ),
    form('a5a5cfd2', 'Lime juice', ['juice'], LIME),
  ];

  it.each([
    // The two 2026-08-14 misses this issue exists to fix.
    ['chicken breast', '4256c30b'],
    ['Chicken legs', 'fb35624f'],
    // The unreported miss it also closes.
    ['lemon zest', '504fbbe1'],
    // Already working, and must keep working.
    ['chicken breasts', '4256c30b'],
    ['2 chicken breasts', '4256c30b'],
    ['4 chicken thighs', 'fb35624f'],
    ['chicken drumsticks', 'fb35624f'],
    ['dark meat', 'fb35624f'],
    ['1 roast chicken carcass', '811ab961'],
    ['200 ml fresh lemon juice', '0e6a6a45'],
    ['zest of lemon', '504fbbe1'],
    ['500 ml beef stock', '33ac24ec'],
    ['2 tbsp oil from the olive jar', 'a926262a'],
    // Longest-wins across two forms that both fit.
    ['fresh lime juice', 'a5a5cfd2'],
  ])('resolves %j to form %s', (text, id) => {
    expect(resolveProductForm(text, live)?.id).toBe(id);
  });

  it.each([
    // A whole bird is not a cut of one — the runbook's Recipe C depends on this
    // line binding to NO form so it sums as a direct purchase.
    ['1 whole chicken'],
    ['plain flour'],
    ['200 g unsalted butter'],
    ['1 tsp sea salt'],
    // Token alignment: "leg" is not a live matcher, and "oil" must not reach the
    // olive-jar form on its own.
    ['2 tbsp olive oil'],
  ])('resolves %j to no form', (text) => {
    expect(resolveProductForm(text, live)).toBeNull();
  });

  it('still mis-resolves any "juice" to Lime — a data fix, not a code one', () => {
    // Documented in issue #818 under "What this does not fix": "juice" is a
    // legitimate whole word, so token alignment cannot rescue this. Only a
    // better matcher on form a5a5cfd2 can. Asserted so the day someone edits
    // that matcher, this test tells them the known wart is gone.
    expect(resolveProductForm('orange juice', live)?.parentCanonId).toBe(LIME);
  });
});
