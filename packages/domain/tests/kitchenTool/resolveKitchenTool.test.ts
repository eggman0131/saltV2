import { describe, it, expect } from 'vitest';
import { resolveKitchenTool } from '@salt/domain';
import type { KitchenToolDoc } from '@salt/domain/schemas';

// The lookup behind the kitchen-tool pictograms (issue #882). A tool is
// identified by its label AND its matchers, both folded with canon's
// normaliseName and matched on whole-token boundaries; longest phrase wins.

function tool(id: string, label: string, matchers: readonly string[]): KitchenToolDoc {
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

const mixingBowl = tool('mixing-bowl', 'Mixing bowl', ['bowl', 'large bowl', 'batter bowl']);
const smallBowl = tool('small-bowl', 'Small bowl', ['ramekin', 'prep bowl']);
const fryingPan = tool('frying-pan', 'Frying pan', ['skillet', 'non-stick pan']);
const saucepan = tool('saucepan', 'Saucepan', ['pan', 'milk pan']);
const KIT = [mixingBowl, smallBowl, fryingPan, saucepan];

describe('resolveKitchenTool', () => {
  it('matches on the label', () => {
    expect(resolveKitchenTool('Mixing bowl', KIT)?.id).toBe('mixing-bowl');
  });

  it('matches on a matcher the label does not contain', () => {
    expect(resolveKitchenTool('skillet', KIT)?.id).toBe('frying-pan');
    expect(resolveKitchenTool('ramekin', KIT)?.id).toBe('small-bowl');
  });

  it('lets the longest phrase win, so a qualified name beats the bare one', () => {
    // "small bowl" (the label, 10 chars) must beat mixing-bowl's "bowl" (4).
    expect(resolveKitchenTool('small bowl', KIT)?.id).toBe('small-bowl');
    // Same shape one row down: "frying pan" beats saucepan's bare "pan".
    expect(resolveKitchenTool('large frying pan', KIT)?.id).toBe('frying-pan');
    // ...and the bare word still resolves when nothing longer fits.
    expect(resolveKitchenTool('a pan', KIT)?.id).toBe('saucepan');
    expect(resolveKitchenTool('the bowl', KIT)?.id).toBe('mixing-bowl');
  });

  it('only lands on whole tokens', () => {
    // "pandan" contains "pan" as a substring and must not match a saucepan.
    expect(resolveKitchenTool('pandan leaves', KIT)).toBeNull();
    expect(resolveKitchenTool('bowline knot', KIT)).toBeNull();
  });

  it('folds plurals, case, punctuation and quantity tokens', () => {
    expect(resolveKitchenTool('MIXING BOWLS', KIT)?.id).toBe('mixing-bowl');
    expect(resolveKitchenTool('2 small bowls', KIT)?.id).toBe('small-bowl');
    // Hyphens become spaces on both sides, so the matcher still fits.
    expect(resolveKitchenTool('a non stick pan', KIT)?.id).toBe('frying-pan');
    expect(resolveKitchenTool("Chef's mixing-bowl!", KIT)?.id).toBe('mixing-bowl');
  });

  it('matches a name the cook made up, as long as a tool word is in it', () => {
    // The real staging shape: "Magmix bowl" is nobody's tool name, but it is a bowl.
    expect(resolveKitchenTool('Magmix bowl', KIT)?.id).toBe('mixing-bowl');
  });

  it('returns null for an unknown name', () => {
    // A miss costs a missing picture and nothing else — no orphan, no queue.
    expect(resolveKitchenTool('hob burner', KIT)).toBeNull();
    expect(resolveKitchenTool('work surface', KIT)).toBeNull();
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(resolveKitchenTool('', KIT)).toBeNull();
    expect(resolveKitchenTool('   ', KIT)).toBeNull();
    // Normalisation strips quantity tokens, so a name of nothing but numbers
    // folds to the empty string and must not match the first tool in the list.
    expect(resolveKitchenTool('2 400g', KIT)).toBeNull();
  });

  it('returns null against an empty vocabulary', () => {
    expect(resolveKitchenTool('mixing bowl', [])).toBeNull();
  });
});
