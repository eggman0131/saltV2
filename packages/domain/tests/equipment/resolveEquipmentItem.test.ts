import { describe, it, expect } from 'vitest';
import { resolveEquipmentItem } from '../../src/index.js';
import type { EquipmentItem } from '../../src/index.js';

// The display-time join from a kit label to the appliance this household owns
// (issue #954). Two properties carry the whole feature and both are asserted
// against the REAL staging manifest shape, because that is where the trap is: the
// household owns two mandolines and five things that answer to "food processor",
// so a generic word must never select one of them, and a branded name must never
// be beaten by the generic tool vocabulary that also matches its tail.

function item(name: string): EquipmentItem {
  return {
    id: `eq-${name}`,
    schemaVersion: 1,
    name,
    accessories: [],
    rules: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

// The staging manifest's relevant slice, names as they are actually stored.
const MANIFEST: EquipmentItem[] = [
  item('Magimix Cook Expert'),
  item('Magimix Cocotte Slow Cook Pot'),
  item('Kenwood MultiPro Go FDP22.130GY'),
  item('Kenwood Chef KVC3100S'),
  item("OXO Good Grips Chef's Mandoline"),
  item('Benriner BN-95W'),
  item('FoodSaver Fresh Container'),
];

describe('resolveEquipmentItem', () => {
  it('finds the item from its own name, verbatim', () => {
    // What the kit flow now writes: the manifest's spelling, capitalisation and
    // all. This is the common case and it must be exact, not fuzzy.
    expect(resolveEquipmentItem("OXO Good Grips Chef's Mandoline", MANIFEST)?.name).toBe(
      "OXO Good Grips Chef's Mandoline",
    );
    expect(resolveEquipmentItem('Magimix Cook Expert', MANIFEST)?.name).toBe('Magimix Cook Expert');
  });

  it('finds it from a shortened name that keeps the maker', () => {
    // A cook — or the model — writing the name from memory drops the middle.
    expect(resolveEquipmentItem('OXO Mandoline', MANIFEST)?.name).toBe(
      "OXO Good Grips Chef's Mandoline",
    );
    expect(resolveEquipmentItem('Kenwood MultiPro Go', MANIFEST)?.name).toBe(
      'Kenwood MultiPro Go FDP22.130GY',
    );
  });

  it('folds case, punctuation and plurals, as the tool resolver does', () => {
    expect(resolveEquipmentItem('  magimix cook expert  ', MANIFEST)?.name).toBe(
      'Magimix Cook Expert',
    );
    expect(resolveEquipmentItem('oxo good grips chefs mandolines', MANIFEST)?.name).toBe(
      "OXO Good Grips Chef's Mandoline",
    );
  });

  it('never matches a generic word against a branded name', () => {
    // THE ordering trap, and the reason equipment is resolved before tools rather
    // than after. "Magimix Cocotte Slow Cook Pot" contains the token "pot"; a
    // containment rule in either direction would hand the bare word "pot" a
    // specific appliance's picture.
    expect(resolveEquipmentItem('pot', MANIFEST)).toBeNull();
    expect(resolveEquipmentItem('slow cooker', MANIFEST)).toBeNull();
    expect(resolveEquipmentItem('large frying pan', MANIFEST)).toBeNull();
    expect(resolveEquipmentItem('container', MANIFEST)).toBeNull();
    expect(resolveEquipmentItem('food processor', MANIFEST)).toBeNull();
  });

  it('returns null for a generic class the household owns several of', () => {
    // Two mandolines, and neither stores the word — so the generic label names
    // nothing, which is exactly the answer. It falls through to `kitchenTools`,
    // where a mandoline pictogram lives.
    expect(resolveEquipmentItem('mandoline', MANIFEST)).toBeNull();
  });

  it('returns null rather than guessing when the maker owns two things', () => {
    // "Kenwood" satisfies both halves against two items. A picture chosen at
    // random is worse than no picture — the #882 graceful-miss contract.
    expect(resolveEquipmentItem('Kenwood', MANIFEST)).toBeNull();
    expect(resolveEquipmentItem('Magimix', MANIFEST)).toBeNull();
  });

  it('rejects a label carrying a word the item does not have', () => {
    // Same maker, wrong machine.
    expect(resolveEquipmentItem('Kenwood MultiPro Chef', MANIFEST)).toBeNull();
    expect(resolveEquipmentItem('Magimix Cook Expert blender', MANIFEST)).toBeNull();
  });

  it('prefers an exact name over a longer one that contains it', () => {
    const items = [item('Magimix Cook Expert XL'), item('Magimix Cook Expert')];
    expect(resolveEquipmentItem('Magimix Cook Expert', items)?.name).toBe('Magimix Cook Expert');
  });

  it('returns null for an empty manifest, a blank label, or a label of digits', () => {
    expect(resolveEquipmentItem('Magimix Cook Expert', [])).toBeNull();
    expect(resolveEquipmentItem('   ', MANIFEST)).toBeNull();
    // `normaliseName` strips numeric tokens entirely, so this normalises to ''.
    expect(resolveEquipmentItem('500', MANIFEST)).toBeNull();
  });
});
