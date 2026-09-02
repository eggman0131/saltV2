import { describe, it, expect } from 'vitest';
import { resolveProductForm } from '@salt/domain';
import type { CanonNaming, ProductForm } from '@salt/domain';
// The canon list `resolveProductForm`'s contested-phrase rule reads (issue
// #1180). Empty here, deliberately: an empty list makes that rule inert, so
// these cases measure the label/matcher behaviour on its own — and that is also
// the pin for "an empty canon list disables the rule entirely", which is the
// degrade a failed canon read lands on (Rule 10).
const NO_CANON: readonly CanonNaming[] = [];

// A form is identified by its label AND its matchers, both folded with canon's
// normaliseName and matched on whole-token boundaries (issue #818).

function form(
  id: string,
  label: string,
  matchers: string[],
  parentCanonId = `parent-${id}`,
): ProductForm {
  return {
    id,
    schemaVersion: 1,
    matchers,
    thumbnail: null,
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
    expect(resolveProductForm('Chicken legs', [legs], NO_CANON)?.id).toBe('legs');
  });

  it('matches a form whose only matcher is worded the other way round', () => {
    // The live "Lemon zest" shape: matcher "zest of lemon", label "Lemon zest".
    const zest = form('zest', 'Lemon zest', ['zest of lemon']);
    expect(resolveProductForm('lemon zest', [zest], NO_CANON)?.id).toBe('zest');
    expect(resolveProductForm('zest of lemon', [zest], NO_CANON)?.id).toBe('zest');
  });

  it('still matches on the matchers when the label does not fit', () => {
    const legs = form('legs', 'Chicken Legs', ['dark meat']);
    expect(resolveProductForm('500 g dark meat', [legs], NO_CANON)?.id).toBe('legs');
  });

  it('lets the label and the matchers compete, longest phrase winning', () => {
    const juice = form('juice', 'Lime juice', ['juice']);
    const posset = form('posset', 'juice', ['fresh lime juice for posset']);
    // "lime juice" (the label, 10 chars) beats "juice" (5) on both forms.
    expect(resolveProductForm('lime juice', [juice, posset], NO_CANON)?.id).toBe('juice');
  });

  it('measures longest-wins on the NORMALISED phrase, not the raw one', () => {
    // Raw: "2 chicken thighs" (16) is longer than "chicken breast" (14), but it
    // normalises to "chicken thigh" (13), so the breast form wins the tie-break.
    const thigh = form('thigh', 'Thighs', ['2 chicken thighs']);
    const breast = form('breast', 'chicken breast', []);
    expect(
      resolveProductForm('chicken thigh and chicken breast', [thigh, breast], NO_CANON)?.id,
    ).toBe('breast');
  });
});

describe('resolveProductForm — plurals and quantities fold away', () => {
  const breast = form('breast', 'chicken breast', ['chicken breasts']);

  it('binds a singular ingredient to a plural phrase', () => {
    // The reported 2026-08-14 defect: this minted an orphan `Chicken Breast`.
    expect(resolveProductForm('chicken breast', [breast], NO_CANON)?.id).toBe('breast');
  });

  it('binds a plural ingredient to a singular phrase', () => {
    const single = form('single', 'chicken breast', []);
    expect(resolveProductForm('chicken breasts', [single], NO_CANON)?.id).toBe('single');
  });

  it('binds identically with a quantity prefix', () => {
    for (const text of ['chicken breast', 'chicken breasts', '2 chicken breasts']) {
      expect(resolveProductForm(text, [breast], NO_CANON)?.id).toBe('breast');
    }
  });

  it('folds punctuation, accents and case', () => {
    const puree = form('puree', 'Tomato purée', []);
    expect(resolveProductForm('2 tbsp TOMATO PUREE, from a tube', [puree], NO_CANON)?.id).toBe(
      'puree',
    );
  });

  it('handles two phrases that normalise to the same string', () => {
    const dupe = form('dupe', 'Chicken Breasts', ['chicken breast']);
    // Both phrases fold to "chicken breast"; the result stays deterministic.
    expect(resolveProductForm('chicken breast', [dupe], NO_CANON)?.id).toBe('dupe');
  });
});

describe('resolveProductForm — matching is token-aligned', () => {
  const oat = form('oat', 'oat', []);
  const pea = form('pea', 'pea', []);

  it('matches a phrase that occupies whole words', () => {
    expect(resolveProductForm('rolled oats', [oat], NO_CANON)?.id).toBe('oat');
    expect(resolveProductForm('frozen peas', [pea], NO_CANON)?.id).toBe('pea');
  });

  it('does not match inside the middle of a word', () => {
    expect(resolveProductForm('goat cheese', [oat], NO_CANON)).toBeNull();
    expect(resolveProductForm('peanut butter', [pea], NO_CANON)).toBeNull();
  });

  it('does not match a phrase straddling a word boundary', () => {
    const nut = form('nut', 'nut butter', []);
    expect(resolveProductForm('peanut butter', [nut], NO_CANON)).toBeNull();
  });
});

describe('resolveProductForm — empty and degenerate input', () => {
  const breast = form('breast', 'chicken breast', ['chicken breasts']);

  it('returns null for empty and whitespace-only ingredient text', () => {
    expect(resolveProductForm('', [breast], NO_CANON)).toBeNull();
    expect(resolveProductForm('   ', [breast], NO_CANON)).toBeNull();
  });

  it('returns null when the ingredient normalises away to nothing', () => {
    // normaliseName strips pure-digit, word-number and digit-prefixed tokens.
    expect(resolveProductForm('2', [breast], NO_CANON)).toBeNull();
    expect(resolveProductForm('three 400g', [breast], NO_CANON)).toBeNull();
    expect(resolveProductForm('!!!', [breast], NO_CANON)).toBeNull();
  });

  it('skips phrases that normalise away to nothing', () => {
    const junk = form('junk', '12', ['   ', '!!!', 'two']);
    expect(resolveProductForm('12 two', [junk], NO_CANON)).toBeNull();
    expect(resolveProductForm('anything at all', [junk], NO_CANON)).toBeNull();
  });

  it('returns null against an empty table', () => {
    expect(resolveProductForm('chicken breast', [], NO_CANON)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(resolveProductForm('plain flour', [breast], NO_CANON)).toBeNull();
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
    expect(resolveProductForm(text, live, NO_CANON)?.id).toBe(id);
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
    expect(resolveProductForm(text, live, NO_CANON)).toBeNull();
  });

  it('still mis-resolves any "juice" to Lime — a data fix, not a code one', () => {
    // Documented in issue #818 under "What this does not fix": "juice" is a
    // legitimate whole word, so token alignment cannot rescue this. Only a
    // better matcher on form a5a5cfd2 can. Asserted so the day someone edits
    // that matcher, this test tells them the known wart is gone.
    expect(resolveProductForm('orange juice', live, NO_CANON)?.parentCanonId).toBe(LIME);
  });
});

// ─── Issue #1180: a phrase may only bind a parent it distinguishes ────────────
describe('resolveProductForm — a contested phrase loses', () => {
  // The reported defect. One stored form, labelled with a bare component word
  // and filed under Lemon. Before #1180 its label matched every parent's zest.
  const zest = form('lemon-zest', 'Zest', ['lemon zest'], 'canon-lemon');
  const CANON = [
    { id: 'canon-lemon', name: 'Lemon' },
    { id: 'canon-lime', name: 'Lime' },
  ];

  it('refuses a bare-noun label when the text names a different canon item', () => {
    // Both phrasings from the issue's reproduction. `null` is the right answer,
    // not a lesser one: the ingredient falls through to ordinary canon matching,
    // which is what mints the correct form on the correct parent.
    expect(resolveProductForm('zest of 1 lime', [zest], CANON)).toBeNull();
    expect(resolveProductForm('lime zest', [zest], CANON)).toBeNull();
  });

  it('still binds when the canon item the text names IS the form parent', () => {
    expect(resolveProductForm('lemon zest', [zest], CANON)?.id).toBe('lemon-zest');
    expect(resolveProductForm('zest of 1 lemon', [zest], CANON)?.id).toBe('lemon-zest');
  });

  it('ignores a canon item named entirely INSIDE the winning phrase', () => {
    // The clause that makes the rule safe rather than merely strict. A canon
    // item called "Whey" sits inside the phrase "active whey", so it is not
    // leftover evidence of a second product — it is part of the name that won.
    const whey = form('whey', 'Active whey', ['active whey'], 'canon-yogurt');
    const canon = [
      { id: 'canon-yogurt', name: 'Plain Yogurt' },
      { id: 'canon-whey', name: 'Whey' },
    ];
    expect(resolveProductForm('100 ml active whey', [whey], canon)?.id).toBe('whey');
  });

  it('lets a shorter uncontested phrase win when the longest is contested', () => {
    // Rejection is PER PHRASE, not per form: a contested phrase neither wins nor
    // raises the longest-wins bar, so a shorter phrase that stands up still
    // answers. Without that, one over-broad phrase anywhere in the table would
    // silently veto every correct shorter match in it.
    //
    // Contrived on purpose — exhibiting it takes a text naming two canon items
    // where the longer phrase leaves one uncovered and the shorter covers it.
    // In "lemon zest of lime", `zest of lime` (12) leaves `lemon` bare and Lemon
    // is not its form's parent, so it is contested; `lemon zest` (10) covers
    // Lemon, and Lime is its form's parent, so it is not.
    const long = form('long', 'Zest of lime', [], 'canon-lime');
    const short = form('short', 'Lemon zest', [], 'canon-lime');
    expect(resolveProductForm('lemon zest of lime', [long, short], CANON)?.id).toBe('short');
  });

  it('ignores a canon item whose name normalises away to nothing', () => {
    // `normaliseName` strips digit and word-number tokens, so a canon item called
    // "2" or "400g" folds to the empty string. It names nothing, so it must
    // contest nothing — otherwise one junk row in `canonItems` would quietly
    // switch form binding off for the whole app.
    expect(
      resolveProductForm('lemon zest', [zest], [...CANON, { id: 'canon-junk', name: '400 g' }])?.id,
    ).toBe('lemon-zest');
  });

  it('is inert with an empty canon list — the failed-read degrade', () => {
    // Rule 10: every caller that cannot read canon passes `[]`, and gets exactly
    // the pre-#1180 answer rather than a refusal. This is also why every case
    // above in this file can pass NO_CANON and still mean what it says.
    expect(resolveProductForm('zest of 1 lime', [zest], NO_CANON)?.id).toBe('lemon-zest');
  });

  it('KNOWN LIMIT — an unnamed rival parent still cannot contest anything', () => {
    // The boundary of the claim, pinned rather than rounded up to "a label can
    // no longer bind across parents" (CLAUDE.md Hard rule 12). The rule needs a
    // canon item to weigh the phrase AGAINST. #818's documented wart survives
    // untouched: with no canon item called Orange, nothing contests the bare
    // matcher "juice", and orange juice still reaches the Lime form.
    const juice = form('juice', 'Lime juice', ['juice'], 'canon-lime');
    expect(resolveProductForm('orange juice', [juice], CANON)?.parentCanonId).toBe('canon-lime');
    // Add the canon item and the same call answers differently — which is the
    // shape of the fix, and the reason this limit is a data gap, not a code one.
    expect(
      resolveProductForm(
        'orange juice',
        [juice],
        [...CANON, { id: 'canon-orange', name: 'Orange' }],
      ),
    ).toBeNull();
  });
});

// NO-REGRESSION FIXTURE (issue #1180). The whole live `productForms` table read
// from staging `s2-stage-ccb22` on 2026-09-02 — 16 rows, ids and text exactly as
// stored — together with every canon item that either parents one of them or
// collides with one of their phrases. Staging was refreshed wholesale from
// production on 2026-08-30, so this is production's table.
//
// Its job is to make "the contested rule changes nothing that is live" MECHANICAL
// rather than asserted in a PR body (Hard rule 12). Measured over these 37 probes
// — every canon name here plus 20 realistic ingredient phrasings — exactly TWO
// answers change, and both are named below with why they are safe. Every other
// row is identical before and after.
describe('resolveProductForm — live staging table, 2026-09-02', () => {
  const BEETROOT = '924d02cb-3580-4a28-a63f-f9b4df8d4a3a';
  const BEEF_STOCK_CUBE = 'aa65d8cc-8f51-4721-9b40-bb8eb695e0e6';
  const WHOLE_CHICKEN = '0288c51e-043e-4d5c-8d75-24007fc85d08';
  const LEMON = 'c74c2ef0-1660-4f6a-8902-ac23c6cc31ce';
  const GARLIC = 'eb60fd36-3f2c-420d-b97a-360b9a475713';
  const MATURE_CHEDDAR = 'f2667b94-9cd1-4056-a76b-4a85fa8e3d20';
  const EGGS = '129b8420-de9d-4368-acd1-f3843c720542';
  const OLIVES = '11f808fd-3b0c-4483-928a-c7e9c8e40432';
  const LIME = 'cd8f724b-8d02-45ec-b658-e494d48d44a9';
  const PLAIN_YOGURT = '63a6276a-20b9-4975-a376-665bf2f15e09';

  const live: ProductForm[] = [
    form('21c8be52', 'Fermented beetroot brine', ['fermented beetroot brine'], BEETROOT),
    form('33ac24ec', 'Beef Stock', ['beef stock'], BEEF_STOCK_CUBE),
    form('4256c30b', 'chicken breast', ['chicken breasts', 'chicken breast'], WHOLE_CHICKEN),
    form('4b5bd723', 'Fresh lemon juice', ['fresh lemon juice', 'lemon juice'], LEMON),
    form(
      '52ed003a',
      'garlic clove',
      ['garlic cloves', 'clove of garlic', 'cloves of garlic'],
      GARLIC,
    ),
    form('72608784', 'Cheddar cheese slice', ['cheddar cheese slices'], MATURE_CHEDDAR),
    form(
      '811ab961',
      'Chicken carcass',
      ['roast chicken carcass', 'chicken carcass'],
      WHOLE_CHICKEN,
    ),
    form('88dd1d36', 'Egg yolk', ['egg yolk'], EGGS),
    form('a414e9f4', 'Chicken Drumstick', ['chicken drumstick'], WHOLE_CHICKEN),
    form('a926262a', 'Olive oil from jar', ['oil from the olive jar'], OLIVES),
    form('db512d77', 'Lime juice', ['lime juice'], LIME),
    form('dfc714ad', 'Lemon zest', ['lemon zest'], LEMON),
    form('e144977c', 'Active whey', ['active whey'], PLAIN_YOGURT),
    form('e164fb23', 'Lime zest', ['lime zest'], LIME),
    form('fb35624f', 'Chicken thigh', ['chicken thighs'], WHOLE_CHICKEN),
    form('fbfc5c88', 'Chicken Leg', ['whole chicken leg'], WHOLE_CHICKEN),
  ];

  // The ten parents, plus the five canon names that collide with a live phrase.
  const canon = [
    { id: BEETROOT, name: 'Beetroot' },
    { id: BEEF_STOCK_CUBE, name: 'Beef Stock Cube' },
    { id: WHOLE_CHICKEN, name: 'Whole Chicken' },
    { id: LEMON, name: 'Lemon' },
    { id: GARLIC, name: 'Garlic Bulbs' },
    { id: MATURE_CHEDDAR, name: 'Mature Cheddar' },
    { id: EGGS, name: 'Eggs' },
    { id: OLIVES, name: 'Delicatessen Olives' },
    { id: LIME, name: 'Lime' },
    { id: PLAIN_YOGURT, name: 'Plain Yogurt' },
    { id: '85fa5fda-cb52-4854-9c74-1fcbada0b466', name: 'Whey' },
    { id: 'ba944d5e-50ea-4d14-b0d7-a6e40d0daab3', name: 'Cheese' },
    { id: '800a1385-a54f-4d97-a691-a4528d8a63be', name: 'Chicken Stock' },
    { id: '1acd63b5-6dba-474a-b884-41c0416dbf8e', name: 'Bottled Lime Juice' },
    { id: 'da287ad0-1f2e-4bad-98d4-4dea9709270e', name: 'Bottled Lemon Juice' },
  ];

  it.each([
    // Realistic phrasings for every form in the table. Identical before and after.
    ['2 chicken breasts', '4256c30b'],
    ['500 g chicken thighs', 'fb35624f'],
    ['1 whole chicken leg', 'fbfc5c88'],
    ['4 chicken drumsticks', 'a414e9f4'],
    ['1 roast chicken carcass', '811ab961'],
    ['lime zest', 'e164fb23'],
    ['lemon zest', 'dfc714ad'],
    ['2 tbsp fresh lemon juice', '4b5bd723'],
    ['30 ml lime juice', 'db512d77'],
    ['3 garlic cloves', '52ed003a'],
    ['2 cloves of garlic', '52ed003a'],
    ['1 egg yolk', '88dd1d36'],
    // The two the "tokens the phrase does not cover" clause exists for: canon
    // `Whey` and canon `Cheese` both sit INSIDE the winning phrase.
    ['100 ml active whey', 'e144977c'],
    ['4 cheddar cheese slices', '72608784'],
    ['500 ml beef stock', '33ac24ec'],
    ['2 tbsp oil from the olive jar', 'a926262a'],
    ['200 ml fermented beetroot brine', '21c8be52'],
    // A canon name that is also a form parent still resolves to that form.
    ['Beef Stock Cube', '33ac24ec'],
  ])('resolves %j to form %s, exactly as it does today', (text, id) => {
    expect(resolveProductForm(text, live, canon)?.id).toBe(id);
  });

  it.each([
    ['Beetroot'],
    ['Whole Chicken'],
    ['Lemon'],
    ['Garlic Bulbs'],
    ['Mature Cheddar'],
    ['Eggs'],
    ['Delicatessen Olives'],
    ['Lime'],
    ['Plain Yogurt'],
    ['Whey'],
    ['Cheese'],
    ['Chicken Stock'],
    ['1 whole chicken'],
    ['1 litre chicken stock'],
    ['200 g grated cheese'],
    ['zest of 1 lemon'],
    ['zest of 1 lime'],
  ])('resolves %j to no form, exactly as it does today', (text) => {
    expect(resolveProductForm(text, live, canon)).toBeNull();
  });

  it.each([
    ['Bottled Lime Juice', 'db512d77'],
    ['Bottled Lemon Juice', '4b5bd723'],
  ])('CHANGED — %j no longer reaches form %s, and that is the intended fix', (text, wasFormId) => {
    // The only two answers in the whole sweep that move. Both are cross-parent
    // binds today: canon "Bottled Lime Juice" is its own buyable product, and
    // the Lime-juice form (parent Lime) was claiming it on the bare phrase
    // "lime juice" while the word "bottled" named nobody it covered.
    //
    // No user reaches the old answer. In the recipe flow the exact-canon
    // precheck settles this text before forms are consulted at all; at the
    // four display sites the form's parent is not the row's own canon item, so
    // the parent guard already turned it into null. The change is real, and it
    // is confined to code paths that were discarding the answer anyway.
    expect(resolveProductForm(text, live, NO_CANON)?.id).toBe(wasFormId);
    expect(resolveProductForm(text, live, canon)).toBeNull();
  });
});
