import { describe, it, expect } from 'vitest';
import { instanceNamedKitchenTools } from '@salt/domain';
import type { KitchenToolDoc } from '@salt/domain/schemas';

// Rule 1 of the seed table, as a function (issue #956).
//
// "Name the object, not the instance" was declared in capitals at the head of
// `kitchen-tool-vocabulary.mjs` and checked by nothing. This is the check, and it
// is the same one the prune script runs against the live collection — so a
// duplicate cannot be legal in production and illegal in the table, or the other
// way round.
//
// The vocabulary below is production's real drifted shape: `Large mixing bowl`
// is an actual `s2-prod-e46bd` document, and `Small bowl` is a deliberate second
// bowl in the seed table. Telling those two apart is the whole job.

function tool(id: string, label: string, matchers: readonly string[] = []): KitchenToolDoc {
  return {
    id,
    schemaVersion: 1,
    label,
    matchers: [...matchers],
    thumbnail: null,
    createdAt: '',
    updatedAt: '',
  };
}

const mixingBowl = tool('mixing-bowl', 'Mixing bowl', ['bowl', 'batter bowl']);
const largeMixingBowl = tool('large-mixing-bowl', 'Large mixing bowl');
const smallBowl = tool('small-bowl', 'Small bowl', ['ramekin']);
const riceCooker = tool('rice-cooker', 'Rice cooker');
const slowCooker = tool('slow-cooker', 'Slow cooker');
const fryingPan = tool('frying-pan', 'Frying pan', ['skillet']);

describe('instanceNamedKitchenTools', () => {
  it('flags a tool whose label contains another tool’s whole label', () => {
    const found = instanceNamedKitchenTools([mixingBowl, largeMixingBowl]);
    expect(found).toHaveLength(1);
    expect(found[0]?.tool.id).toBe('large-mixing-bowl');
    expect(found[0]?.parent.id).toBe('mixing-bowl');
  });

  it('does not flag a deliberate second object that only shares a matcher', () => {
    // `Small bowl` contains `Mixing bowl`'s MATCHER "bowl", never its label. A
    // ramekin is not a mixing bowl and gets its own drawing on purpose — a rule
    // that folded it would forbid the seed table's own contents.
    expect(instanceNamedKitchenTools([mixingBowl, smallBowl])).toEqual([]);
  });

  it('does not flag tools that merely share a head noun', () => {
    // Four cookers are four appliances. Containment, not clustering.
    expect(instanceNamedKitchenTools([riceCooker, slowCooker, fryingPan])).toEqual([]);
  });

  it('takes the longest containing label as the parent', () => {
    // `Large mixing bowl` folds into `Mixing bowl`, not into a barer `Bowl`:
    // longest-phrase-wins is what makes that pair the SHADOWING pair, and
    // matching the resolver here is why the report names the row that is
    // actually being stolen from.
    const bowl = tool('bowl', 'Bowl');
    const found = instanceNamedKitchenTools([bowl, mixingBowl, largeMixingBowl]);
    expect(found.map((f) => [f.tool.id, f.parent.id])).toEqual([
      ['large-mixing-bowl', 'mixing-bowl'],
      ['mixing-bowl', 'bowl'],
    ]);
  });

  it('folds spelling the way the resolver does', () => {
    // Casing, hyphens, punctuation and plurals are `normaliseName`'s business,
    // and this must not have a second opinion about them: a duplicate spelled
    // "Large Mixing Bowls" is the same duplicate.
    const shouty = tool('large-mixing-bowls', 'Large Mixing Bowls');
    expect(instanceNamedKitchenTools([mixingBowl, shouty])[0]?.parent.id).toBe('mixing-bowl');
  });

  it('reports nothing for a vocabulary that obeys rule 1', () => {
    expect(instanceNamedKitchenTools([mixingBowl, smallBowl, riceCooker, fryingPan])).toEqual([]);
    expect(instanceNamedKitchenTools([])).toEqual([]);
    expect(instanceNamedKitchenTools([mixingBowl])).toEqual([]);
  });

  it('is stable under input reordering', () => {
    // The prune script merges a Firestore listing with the seed table, and a
    // report that reshuffles between runs is a report an operator cannot diff.
    const forwards = instanceNamedKitchenTools([
      mixingBowl,
      largeMixingBowl,
      smallBowl,
      riceCooker,
    ]);
    const backwards = instanceNamedKitchenTools([
      riceCooker,
      smallBowl,
      largeMixingBowl,
      mixingBowl,
    ]);
    expect(backwards.map((f) => [f.tool.id, f.parent.id])).toEqual(
      forwards.map((f) => [f.tool.id, f.parent.id]),
    );
  });

  it('treats two spellings of one name as a collision, not a parent and a child', () => {
    // Equal normalised labels contain each other, so a naive containment test
    // would flag both rows and offer to delete the pair. That is a uniqueness
    // problem for the table's own hygiene test to report; neither row is an
    // instance of the other.
    expect(instanceNamedKitchenTools([mixingBowl, tool('mixing-bowls', 'Mixing bowls')])).toEqual(
      [],
    );
  });
});
