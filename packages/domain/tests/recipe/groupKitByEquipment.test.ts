import { describe, it, expect } from 'vitest';
import { groupKitByEquipment } from '@salt/domain';
import type { EquipmentItem, KitEquipmentGroup } from '@salt/domain';
import type { RecipeKitEntryDoc } from '@salt/domain/schemas';

// Accessories under their appliance (issue #1140).
//
// Every kit list below is real staging output (2026-08-31) or a collision the
// manifest genuinely makes possible — the point of the query is that it behaves on
// the library that exists, not on a shape invented to make it look good.
//
// Three of these cases are the safety properties the design rests on, and each is
// written so it goes RED if the guard is removed rather than merely passing today:
//   • an accessory whose appliance is absent is never nested (and never invents it);
//   • two appliances owning the same accessory name nest nothing;
//   • every entry appears exactly once, so the tab's count stays `kit.length`.

function entry(label: string): RecipeKitEntryDoc {
  return { label, stepIds: [] };
}

function item(id: string, name: string, accessories: readonly string[] = []): EquipmentItem {
  return {
    id,
    schemaVersion: 1,
    name,
    accessories: accessories.map((accName, i) => ({
      id: `${id}-acc-${i}`,
      name: accName,
      owned: true,
      included: true,
    })),
    rules: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** The rendered shape: one entry per line, an accessory line marked by its indent. */
function lines(groups: readonly KitEquipmentGroup[]): string[] {
  return groups.flatMap((group) => [
    group.entry.label,
    ...group.accessories.map((a) => `  ↳ ${a.label}`),
  ]);
}

// The four appliances the staging cases below name, with the accessory names the
// manifest actually stores for them.
const RICE_COOKER = item('eq-cosori', 'Cosori 5L Rice Cooker', ['Rice Spoon', 'Measuring Cup']);
const HAND_BLENDER = item('eq-ninja', 'Ninja Foodi 3-in-1 Hand Blender, Mixer & Chopper CI100UK', [
  'Hand Blender Attachment',
  'Chopper Bowl',
]);
const ANOVA = item('eq-anova', 'Anova Precision Oven', ['Oven Sheet Pan', 'Wire Oven Rack']);
const SAGE_Q = item('eq-sage-q', 'Sage The Super Q', ['Spatula', 'Tamper']);

describe('groupKitByEquipment', () => {
  it('folds a bare accessory name under the appliance beside it', () => {
    // Staging: `['sieve', 'Cosori 5L Rice Cooker', 'Rice Spoon']`. "Rice Spoon"
    // carries no maker, so `resolveEquipmentItem` refuses it outright — which is
    // correct and stays correct; the second pass is what reads it here.
    const groups = groupKitByEquipment(
      [entry('sieve'), entry('Cosori 5L Rice Cooker'), entry('Rice Spoon')],
      [RICE_COOKER, ANOVA],
    );

    expect(lines(groups)).toEqual(['sieve', 'Cosori 5L Rice Cooker', '  ↳ Rice Spoon']);
  });

  it('folds an accessory under a long product name the label only partly repeats', () => {
    // Staging: the Ninja's kit label is the full catalogue name, model number and
    // all. Pass one resolves it; pass two then has a head to attach to.
    const groups = groupKitByEquipment(
      [
        entry('tall glass jar'),
        entry('Ninja Foodi 3-in-1 Hand Blender, Mixer & Chopper CI100UK'),
        entry('Hand Blender Attachment'),
      ],
      [HAND_BLENDER, RICE_COOKER],
    );

    expect(lines(groups)).toEqual([
      'tall glass jar',
      'Ninja Foodi 3-in-1 Hand Blender, Mixer & Chopper CI100UK',
      '  ↳ Hand Blender Attachment',
    ]);
  });

  it('never nests an accessory whose appliance the recipe did not ask for', () => {
    // Staging's Baked Camembert: sheet pan and oven rack with no Anova anywhere.
    // The list's job is to say what to get OUT — promoting a whole steam oven to a
    // heading because the recipe wants a baking tray is a worse answer than a flat
    // list. Both stay top-level, and NO oven appears.
    const groups = groupKitByEquipment(
      [
        entry('small frying pan'),
        entry('wooden spoon'),
        entry('sharp knife'),
        entry('Oven Sheet Pan'),
        entry('Wire Oven Rack'),
        entry('spoon'),
      ],
      [ANOVA, RICE_COOKER],
    );

    expect(lines(groups)).toEqual([
      'small frying pan',
      'wooden spoon',
      'sharp knife',
      'Oven Sheet Pan',
      'Wire Oven Rack',
      'spoon',
    ]);
    expect(lines(groups).some((line) => line.includes('Anova'))).toBe(false);
  });

  it('nests nothing when two appliances present in this kit own the same accessory name', () => {
    // The manifest really does put a "Measuring Cup" on the rice cooker; give a
    // second appliance in the same kit one too and the word says nothing. Guessing
    // one of them is worse than an unindented line.
    const rival = item('eq-rival', 'Kenwood Chef', ['Measuring Cup']);
    const groups = groupKitByEquipment(
      [entry('Cosori 5L Rice Cooker'), entry('Kenwood Chef'), entry('Measuring Cup')],
      [RICE_COOKER, rival],
    );

    expect(lines(groups)).toEqual(['Cosori 5L Rice Cooker', 'Kenwood Chef', 'Measuring Cup']);
  });

  it('still nests when the rival owner is NOT in this kit — the tie has to be live', () => {
    // The same collision, with only one of the two appliances actually called for.
    // Condition 3 is what makes the ambiguity local: an item nobody asked for
    // cannot make a word ambiguous.
    const rival = item('eq-rival', 'Kenwood Chef', ['Measuring Cup']);
    const groups = groupKitByEquipment(
      [entry('Cosori 5L Rice Cooker'), entry('Measuring Cup')],
      [RICE_COOKER, rival],
    );

    expect(lines(groups)).toEqual(['Cosori 5L Rice Cooker', '  ↳ Measuring Cup']);
  });

  it('leaves a generic word alone when its owning appliance is absent', () => {
    // "Spatula" is an accessory of the Sage The Super Q in the real manifest. A
    // recipe saying "spatula" beside a rice cooker must not file itself under the
    // blender — this is the case condition 3 exists for, and it is why conditions
    // 1-2 are safe to have at all.
    const groups = groupKitByEquipment(
      [entry('Cosori 5L Rice Cooker'), entry('spatula')],
      [RICE_COOKER, SAGE_Q],
    );

    expect(lines(groups)).toEqual(['Cosori 5L Rice Cooker', 'spatula']);
  });

  it('matches the accessory name EXACTLY, never by containment or prefix', () => {
    // "Sheet Pan" is a substring of the Anova's "Oven Sheet Pan" and must not find
    // it; containment is precisely the loosening `resolveEquipmentItem` refuses,
    // and the narrow second pass does not reintroduce it by the back door.
    const groups = groupKitByEquipment(
      [entry('Anova Precision Oven'), entry('sheet pan'), entry('Oven Sheet Pan Liner')],
      [ANOVA],
    );

    expect(lines(groups)).toEqual(['Anova Precision Oven', 'sheet pan', 'Oven Sheet Pan Liner']);
  });

  it('folds case, punctuation and plurals through the shared normaliser', () => {
    // `normaliseName` is the one normaliser both sides use, so "rice spoons" and
    // "RICE SPOON!" are the same word as far as this is concerned — nothing here
    // hand-rolls case or plural handling.
    const groups = groupKitByEquipment(
      [entry('Cosori 5L Rice Cooker'), entry('RICE SPOONS!')],
      [RICE_COOKER],
    );

    expect(lines(groups)).toEqual(['Cosori 5L Rice Cooker', '  ↳ RICE SPOONS!']);
  });

  it('nests an accessory named BEFORE its appliance', () => {
    // Stored order decides where the HEADS go; it does not decide what belongs to
    // what. The flow has no rule about listing an appliance before its bits.
    const groups = groupKitByEquipment(
      [entry('Rice Spoon'), entry('Cosori 5L Rice Cooker')],
      [RICE_COOKER],
    );

    expect(lines(groups)).toEqual(['Cosori 5L Rice Cooker', '  ↳ Rice Spoon']);
  });

  it('returns a flat list when the manifest is empty or has not loaded yet', () => {
    // A cold load paints before the manifest lands. Flat is the correct reading of
    // "nothing is known to be owned", not a degraded one.
    const groups = groupKitByEquipment([entry('Cosori 5L Rice Cooker'), entry('Rice Spoon')], []);

    expect(lines(groups)).toEqual(['Cosori 5L Rice Cooker', 'Rice Spoon']);
  });

  it('returns nothing for an empty kit', () => {
    expect(groupKitByEquipment([], [RICE_COOKER])).toEqual([]);
  });

  it('nests the SECOND mention under the first, rather than duplicating the head', () => {
    // Not something the flow produces as a literal repeat, but a second entry
    // resolving to the same item is exactly what a *prefixed accessory* label does
    // (see the next case) — so both must nest, or the flow-produced case would stay
    // broken. A second top-level head wearing the same picture is the "two
    // unrelated things" reading Phase 2 exists to remove (#1179 review finding B2).
    const groups = groupKitByEquipment(
      [entry('Cosori 5L Rice Cooker'), entry('Cosori Rice Cooker'), entry('Rice Spoon')],
      [RICE_COOKER],
    );

    expect(lines(groups)).toEqual([
      'Cosori 5L Rice Cooker',
      '  ↳ Cosori Rice Cooker',
      '  ↳ Rice Spoon',
    ]);
  });

  it('nests a PREFIXED accessory label under the appliance it already resolved to in pass one', () => {
    // "Magimix Cocotte Slow Cook Pot" is not pass two's territory at all — pass one
    // resolves it straight to the Magimix, the same way "FoodSaver Fresh Container"
    // does (`resolveEquipmentItem`'s header). Naming both the item and one of its
    // accessories in prefixed form used to leave the panel with two top-level rows
    // sharing one picture; this is the regression test for that fix (#1179 review
    // finding B2, not present in staging today — a latent case, not a live one).
    const magimix = item('eq-magimix', 'Magimix Cook Expert', ['Cocotte Slow Cook Pot']);
    const groups = groupKitByEquipment(
      [entry('Magimix Cook Expert'), entry('Magimix Cocotte Slow Cook Pot')],
      [magimix],
    );

    expect(lines(groups)).toEqual(['Magimix Cook Expert', '  ↳ Magimix Cocotte Slow Cook Pot']);
  });

  it('leaves a label that normalises to nothing as its own row', () => {
    // `normaliseName` strips bare and digit-prefixed numbers, so a kit entry of
    // "500g" folds to the empty string. It is still a line the flow wrote and still
    // gets rendered; it simply cannot name an accessory.
    const groups = groupKitByEquipment(
      [entry('Cosori 5L Rice Cooker'), entry('500g'), entry('Rice Spoon')],
      [RICE_COOKER],
    );

    expect(lines(groups)).toEqual(['Cosori 5L Rice Cooker', '  ↳ Rice Spoon', '500g']);
  });

  it('treats an item carrying no accessories array as owning none', () => {
    // `EquipmentItemSchema.accessories` has a `.default([])`, so a Firestore read
    // always has the array — but the shape reaches this query from test fixtures and
    // hand-built objects too, and `resolveEquipmentItem` carries the identical guard
    // for the identical reason. The cast is what a JS caller can genuinely hand over.
    const bare = {
      id: 'eq-bare',
      schemaVersion: 1,
      name: 'Sage Pizzaiolo',
      rules: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as EquipmentItem;
    const groups = groupKitByEquipment([entry('Sage Pizzaiolo'), entry('Rice Spoon')], [bare]);

    expect(lines(groups)).toEqual(['Sage Pizzaiolo', 'Rice Spoon']);
  });

  it('renders every entry exactly once, whatever the grouping — so the tab count holds', () => {
    // The property the Equipment tab's `count={kit.length}` rests on. Asserted over
    // every kit in this file at once, because the way this breaks is a later change
    // adding a THIRD disposition — dropped, or nested under two heads — that one
    // hand-written case would not happen to cover.
    const kits: RecipeKitEntryDoc[][] = [
      [entry('sieve'), entry('Cosori 5L Rice Cooker'), entry('Rice Spoon')],
      [entry('Cosori 5L Rice Cooker'), entry('Kenwood Chef'), entry('Measuring Cup')],
      [entry('Oven Sheet Pan'), entry('Wire Oven Rack')],
      [entry('Rice Spoon'), entry('Cosori 5L Rice Cooker'), entry('Measuring Cup')],
      [entry('Anova Precision Oven'), entry('Oven Sheet Pan'), entry('Wire Oven Rack')],
    ];
    const manifest = [
      RICE_COOKER,
      HAND_BLENDER,
      ANOVA,
      SAGE_Q,
      item('eq-rival', 'Kenwood Chef', ['Measuring Cup']),
    ];

    for (const kit of kits) {
      const rendered = lines(groupKitByEquipment(kit, manifest));
      expect(rendered).toHaveLength(kit.length);
      expect(rendered.map((line) => line.replace('  ↳ ', '')).sort()).toEqual(
        kit.map((e) => e.label).sort(),
      );
    }
  });
});
