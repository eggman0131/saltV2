import { describe, it, expect } from 'vitest';
import { parseShoppingListEntry } from '../../src/shoppingList/queries/parseEntry.js';

describe('parseShoppingListEntry', () => {
  it('splits a trailing "for ..." phrase into name + context', () => {
    expect(parseShoppingListEntry('birthday card for bob')).toEqual({
      name: 'birthday card',
      context: 'for bob',
    });
    expect(parseShoppingListEntry('rice for risotto')).toEqual({
      name: 'rice',
      context: 'for risotto',
    });
  });

  it('splits at the first standalone "for" (Broad rule)', () => {
    expect(parseShoppingListEntry('rice for risotto for friday')).toEqual({
      name: 'rice',
      context: 'for risotto for friday',
    });
  });

  it('leaves a plain entry unchanged with empty context', () => {
    expect(parseShoppingListEntry('milk')).toEqual({ name: 'milk', context: '' });
    expect(parseShoppingListEntry('olive oil')).toEqual({ name: 'olive oil', context: '' });
  });

  it('does not match "for" inside a word', () => {
    expect(parseShoppingListEntry('comfort food')).toEqual({
      name: 'comfort food',
      context: '',
    });
  });

  it('does not strip when "for" is the first word', () => {
    expect(parseShoppingListEntry('for here')).toEqual({ name: 'for here', context: '' });
  });

  it('does not strip a trailing bare "for" with no content after it', () => {
    expect(parseShoppingListEntry('card for')).toEqual({ name: 'card for', context: '' });
    expect(parseShoppingListEntry('card for   ')).toEqual({ name: 'card for', context: '' });
  });

  it('falls back to the original entry when the strip leaves an empty name', () => {
    // "4" normalises to empty (digit-only word stripped) — keep the entry intact.
    expect(parseShoppingListEntry('4 for £1')).toEqual({ name: '4 for £1', context: '' });
  });

  it('trims surrounding and split whitespace', () => {
    expect(parseShoppingListEntry('  birthday card   for   bob  ')).toEqual({
      name: 'birthday card',
      context: 'for bob',
    });
  });

  it('preserves the original casing of name and context', () => {
    expect(parseShoppingListEntry('Birthday Card For Bob')).toEqual({
      name: 'Birthday Card',
      context: 'For Bob',
    });
  });

  it('returns the entry unchanged for blank input', () => {
    expect(parseShoppingListEntry('')).toEqual({ name: '', context: '' });
    expect(parseShoppingListEntry('   ')).toEqual({ name: '', context: '' });
  });
});
