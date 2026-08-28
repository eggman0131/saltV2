import { describe, it, expect } from 'vitest';
import { suggestKitchenToolParent } from '@salt/domain';
import type { KitchenToolDoc } from '@salt/domain/schemas';

// The advisory hint behind the curation queue's one-click alias (issue #956).
//
// Everything here is about the boundary between a good hint and a bad rule. It
// may say "this is probably a bowl"; it may never be the thing that decides.
//
// The vocabulary below is production's real drifted shape rather than a tidy
// one: `Large mixing bowl` is an actual document in `s2-prod-e46bd`, minted from
// the queue one row at a time, and it is the reason plain "mixing bowl" is
// unresolved and in need of a hint at all.

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

const largeMixingBowl = tool('large-mixing-bowl', 'Large mixing bowl');
const smallBowl = tool('small-bowl', 'Small bowl', ['ramekin']);
const cakeTin = tool('cake-tin', 'Cake tin');
const loafTin = tool('loaf-tin', 'Loaf tin');
const riceCooker = tool('rice-cooker', 'Rice cooker');
const slowCooker = tool('slow-cooker', 'Slow cooker');
const pressureCooker = tool('pressure-cooker', 'Pressure cooker');
const KIT = [largeMixingBowl, smallBowl, cakeTin, loafTin, riceCooker, slowCooker, pressureCooker];

describe('suggestKitchenToolParent', () => {
  it('suggests the tool that shares the label’s head noun', () => {
    expect(suggestKitchenToolParent('muffin tin', KIT)?.id).toBe('cake-tin');
    expect(suggestKitchenToolParent('heatproof bowl', KIT)?.id).toBe('small-bowl');
  });

  it('prefers the candidate that shares more of the words', () => {
    // Two shared words beat one: "medium mixing bowl" is the same object as
    // `Large mixing bowl`, not a size of `Small bowl`. This is the case that
    // fixes production's own duplicate.
    expect(suggestKitchenToolParent('medium mixing bowl', KIT)?.id).toBe('large-mixing-bowl');
    expect(suggestKitchenToolParent('mixing bowl', KIT)?.id).toBe('large-mixing-bowl');
  });

  it('suggests nothing when no tool shares the head noun', () => {
    expect(suggestKitchenToolParent('pasta machine', KIT)).toBeNull();
    expect(suggestKitchenToolParent('dough scraper', KIT)).toBeNull();
  });

  it('suggests nothing for a label the vocabulary already resolves', () => {
    // These are not queue rows at all: "large mixing bowl" already draws, and a
    // matcher for it would change nothing. Answering anyway would invite a write
    // whose only effect is to make the table longer.
    expect(suggestKitchenToolParent('large mixing bowl', KIT)).toBeNull();
    expect(suggestKitchenToolParent('ramekin', KIT)).toBeNull();
    expect(suggestKitchenToolParent('Rice cooker', KIT)).toBeNull();
  });

  it('suggests nothing for words that name no tool at all', () => {
    expect(suggestKitchenToolParent('', KIT)).toBeNull();
    expect(suggestKitchenToolParent('   ', KIT)).toBeNull();
    // Normalises away entirely — a quantity that wandered into a container field.
    expect(suggestKitchenToolParent('500g', KIT)).toBeNull();
    expect(suggestKitchenToolParent('mixing bowl', [])).toBeNull();
  });

  it('is a hint, not a fold: it still answers when the answer is wrong', () => {
    // Three cookers, three different machines. The hint names one of them and a
    // person overrules it — which is exactly why nothing downstream may act on
    // this without a click.
    const suggestion = suggestKitchenToolParent('egg cooker', KIT);
    expect(suggestion).not.toBeNull();
    expect(['rice-cooker', 'slow-cooker', 'pressure-cooker']).toContain(suggestion?.id);
  });

  it('answers the same way every time, so the button does not reword itself', () => {
    // Equal candidates are broken alphabetically rather than by table order, so a
    // vocabulary that arrives in a different order still renders the same row.
    const forward = suggestKitchenToolParent('egg cooker', [riceCooker, slowCooker]);
    const backward = suggestKitchenToolParent('egg cooker', [slowCooker, riceCooker]);
    expect(forward?.id).toBe(backward?.id);
    expect(forward?.id).toBe('rice-cooker');
  });

  it('folds case, plurals and punctuation exactly as the resolver does', () => {
    expect(suggestKitchenToolParent('Medium Mixing Bowls', KIT)?.id).toBe('large-mixing-bowl');
    expect(suggestKitchenToolParent('2 muffin tins', KIT)?.id).toBe('cake-tin');
  });
});
