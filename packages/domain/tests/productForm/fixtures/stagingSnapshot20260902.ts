// The live `productForms` table read from staging `s2-stage-ccb22` on
// 2026-09-02 (refreshed wholesale from production on 2026-08-30) — 16 rows,
// ids and text exactly as stored. Shared by `resolveProductForm.test.ts` and
// `proposalRejectionReason.test.ts` (issue #1196): before this it was
// hand-duplicated in both files, so a staging reseed had to be applied twice
// and could silently go stale in one without the other noticing.
//
// `resolveProductForm.test.ts` builds full `ProductForm` fixtures from these
// rows (plus its own canon-collision and pantry-staple entries, which are not
// duplicated anywhere else — leave those hand-written there).
// `proposalRejectionReason.test.ts` only needs `label` and `parentName`: the
// fifteen it asserts clear the rule, and the sixteenth ("Active whey" on
// "Plain Yogurt") it asserts does not.
//
// A staging reseed updates this one file; both test files pick it up on their
// next run.

export interface StagingFormRow {
  readonly id: string;
  readonly label: string;
  readonly matchers: readonly string[];
  readonly parentId: string;
  readonly parentName: string;
}

// Canon ids of the ten parents, named once so a form row here and the canon
// list `resolveProductForm.test.ts` builds from them cannot disagree about
// identity.
export const STAGING_CANON_IDS = {
  BEETROOT: '924d02cb-3580-4a28-a63f-f9b4df8d4a3a',
  BEEF_STOCK_CUBE: 'aa65d8cc-8f51-4721-9b40-bb8eb695e0e6',
  WHOLE_CHICKEN: '0288c51e-043e-4d5c-8d75-24007fc85d08',
  LEMON: 'c74c2ef0-1660-4f6a-8902-ac23c6cc31ce',
  GARLIC: 'eb60fd36-3f2c-420d-b97a-360b9a475713',
  MATURE_CHEDDAR: 'f2667b94-9cd1-4056-a76b-4a85fa8e3d20',
  EGGS: '129b8420-de9d-4368-acd1-f3843c720542',
  OLIVES: '11f808fd-3b0c-4483-928a-c7e9c8e40432',
  LIME: 'cd8f724b-8d02-45ec-b658-e494d48d44a9',
  PLAIN_YOGURT: '63a6276a-20b9-4975-a376-665bf2f15e09',
} as const;

const {
  BEETROOT,
  BEEF_STOCK_CUBE,
  WHOLE_CHICKEN,
  LEMON,
  GARLIC,
  MATURE_CHEDDAR,
  EGGS,
  OLIVES,
  LIME,
  PLAIN_YOGURT,
} = STAGING_CANON_IDS;

export const STAGING_FORM_ROWS: readonly StagingFormRow[] = [
  {
    id: '21c8be52',
    label: 'Fermented beetroot brine',
    matchers: ['fermented beetroot brine'],
    parentId: BEETROOT,
    parentName: 'Beetroot',
  },
  {
    id: '33ac24ec',
    label: 'Beef Stock',
    matchers: ['beef stock'],
    parentId: BEEF_STOCK_CUBE,
    parentName: 'Beef Stock Cube',
  },
  {
    id: '4256c30b',
    label: 'chicken breast',
    matchers: ['chicken breasts', 'chicken breast'],
    parentId: WHOLE_CHICKEN,
    parentName: 'Whole Chicken',
  },
  {
    id: '4b5bd723',
    label: 'Fresh lemon juice',
    matchers: ['fresh lemon juice', 'lemon juice'],
    parentId: LEMON,
    parentName: 'Lemon',
  },
  {
    id: '52ed003a',
    label: 'garlic clove',
    matchers: ['garlic cloves', 'clove of garlic', 'cloves of garlic'],
    parentId: GARLIC,
    parentName: 'Garlic Bulbs',
  },
  {
    id: '72608784',
    label: 'Cheddar cheese slice',
    matchers: ['cheddar cheese slices'],
    parentId: MATURE_CHEDDAR,
    parentName: 'Mature Cheddar',
  },
  {
    id: '811ab961',
    label: 'Chicken carcass',
    matchers: ['roast chicken carcass', 'chicken carcass'],
    parentId: WHOLE_CHICKEN,
    parentName: 'Whole Chicken',
  },
  {
    id: '88dd1d36',
    label: 'Egg yolk',
    matchers: ['egg yolk'],
    parentId: EGGS,
    parentName: 'Eggs',
  },
  {
    id: 'a414e9f4',
    label: 'Chicken Drumstick',
    matchers: ['chicken drumstick'],
    parentId: WHOLE_CHICKEN,
    parentName: 'Whole Chicken',
  },
  {
    id: 'a926262a',
    label: 'Olive oil from jar',
    matchers: ['oil from the olive jar'],
    parentId: OLIVES,
    parentName: 'Delicatessen Olives',
  },
  {
    id: 'db512d77',
    label: 'Lime juice',
    matchers: ['lime juice'],
    parentId: LIME,
    parentName: 'Lime',
  },
  {
    id: 'dfc714ad',
    label: 'Lemon zest',
    matchers: ['lemon zest'],
    parentId: LEMON,
    parentName: 'Lemon',
  },
  {
    id: 'e144977c',
    label: 'Active whey',
    matchers: ['active whey'],
    parentId: PLAIN_YOGURT,
    parentName: 'Plain Yogurt',
  },
  {
    id: 'e164fb23',
    label: 'Lime zest',
    matchers: ['lime zest'],
    parentId: LIME,
    parentName: 'Lime',
  },
  {
    id: 'fb35624f',
    label: 'Chicken thigh',
    matchers: ['chicken thighs'],
    parentId: WHOLE_CHICKEN,
    parentName: 'Whole Chicken',
  },
  {
    id: 'fbfc5c88',
    label: 'Chicken Leg',
    matchers: ['whole chicken leg'],
    parentId: WHOLE_CHICKEN,
    parentName: 'Whole Chicken',
  },
];
