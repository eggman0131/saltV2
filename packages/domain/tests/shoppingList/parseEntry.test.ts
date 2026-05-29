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

describe('parseShoppingListEntry — amount/unit extraction', () => {
  it('extracts amount and unit when number is attached to unit', () => {
    expect(parseShoppingListEntry('2kg maris piper potatoes')).toEqual({
      amount: 2,
      unit: 'kg',
      name: 'maris piper potatoes',
      context: '',
    });
    expect(parseShoppingListEntry('500g potatoes')).toEqual({
      amount: 500,
      unit: 'g',
      name: 'potatoes',
      context: '',
    });
  });

  it('extracts amount with no unit for a bare leading number', () => {
    expect(parseShoppingListEntry('3 onions')).toEqual({
      amount: 3,
      name: 'onions',
      context: '',
    });
  });

  it('extracts amount and unit when separated by a space', () => {
    expect(parseShoppingListEntry('2 kg potatoes')).toEqual({
      amount: 2,
      unit: 'kg',
      name: 'potatoes',
      context: '',
    });
  });

  it('preserves product-distinguishing adjectives in the name', () => {
    // "red" is not a unit — stays in the name
    expect(parseShoppingListEntry('2 red onions')).toEqual({
      amount: 2,
      name: 'red onions',
      context: '',
    });
  });

  it('handles decimal amounts', () => {
    expect(parseShoppingListEntry('1.5 kg flour')).toEqual({
      amount: 1.5,
      unit: 'kg',
      name: 'flour',
      context: '',
    });
  });

  it('combines amount/unit extraction with trailing-for rule', () => {
    expect(parseShoppingListEntry('2kg flour for the cake')).toEqual({
      amount: 2,
      unit: 'kg',
      name: 'flour',
      context: 'for the cake',
    });
  });

  it('extracts amount from a leading English word-number', () => {
    expect(parseShoppingListEntry('one cucumber')).toEqual({
      amount: 1,
      name: 'cucumber',
      context: '',
    });
    expect(parseShoppingListEntry('three onions')).toEqual({
      amount: 3,
      name: 'onions',
      context: '',
    });
    expect(parseShoppingListEntry('twelve eggs')).toEqual({
      amount: 12,
      name: 'eggs',
      context: '',
    });
  });

  it('word-number extraction is case-insensitive', () => {
    expect(parseShoppingListEntry('One Cucumber')).toEqual({
      amount: 1,
      name: 'Cucumber',
      context: '',
    });
  });

  it('combines word-number extraction with trailing-for rule', () => {
    expect(parseShoppingListEntry('two avocados for the salad')).toEqual({
      amount: 2,
      name: 'avocados',
      context: 'for the salad',
    });
  });

  it('extracts amount and unit from a trailing attached number-unit', () => {
    expect(parseShoppingListEntry('cucumber 400g')).toEqual({
      amount: 400,
      unit: 'g',
      name: 'cucumber',
      context: '',
    });
    expect(parseShoppingListEntry('coca cola 1.5l')).toEqual({
      amount: 1.5,
      unit: 'l',
      name: 'coca cola',
      context: '',
    });
  });

  it('extracts amount and unit from a trailing space-separated known unit', () => {
    expect(parseShoppingListEntry('potatoes 1 kg')).toEqual({
      amount: 1,
      unit: 'kg',
      name: 'potatoes',
      context: '',
    });
  });

  it('extracts a bare trailing count', () => {
    expect(parseShoppingListEntry('tomatoes 6')).toEqual({
      amount: 6,
      name: 'tomatoes',
      context: '',
    });
  });

  it('combines trailing quantity with the trailing-for rule', () => {
    expect(parseShoppingListEntry('flour 400g for the cake')).toEqual({
      amount: 400,
      unit: 'g',
      name: 'flour',
      context: 'for the cake',
    });
  });

  it('does not extract trailing quantity when the unit word is not recognised', () => {
    // "3 bobs" — "bobs" is not a unit word, and text does not end in a bare number
    const result = parseShoppingListEntry('birthday card for bob');
    expect(result.amount).toBeUndefined();
  });

  it('leading quantity takes priority over trailing', () => {
    // Leading "2kg" is extracted first; trailing extraction is skipped
    expect(parseShoppingListEntry('2kg flour')).toMatchObject({
      amount: 2,
      unit: 'kg',
      name: 'flour',
    });
  });

  it('treats leading "a" as quantity 1', () => {
    expect(parseShoppingListEntry('a bunch of bananas')).toMatchObject({
      amount: 1,
      name: 'bunch of bananas',
    });
    expect(parseShoppingListEntry('a couple of onions')).toMatchObject({
      amount: 1,
      name: 'couple of onions',
    });
  });

  it('does not extract when the remainder after the number starts with "for" (price notation)', () => {
    // "4 for £1" is price notation, not a quantity — existing safety fallback applies
    expect(parseShoppingListEntry('4 for £1')).toEqual({ name: '4 for £1', context: '' });
    expect(parseShoppingListEntry('2 for £1')).toEqual({ name: '2 for £1', context: '' });
  });

  it('does not extract when extraction would leave an empty normalised name', () => {
    // A number followed by only punctuation would normalise to empty — keep intact
    const result = parseShoppingListEntry('2 ££');
    expect(result.amount).toBeUndefined();
    expect(result.name).toBe('2 ££');
  });

  it('preserves unit casing as written by the user', () => {
    expect(parseShoppingListEntry('2Kg flour')).toMatchObject({ amount: 2, unit: 'Kg' });
    expect(parseShoppingListEntry('500G sugar')).toMatchObject({ amount: 500, unit: 'G' });
  });

  it('plain entries without a leading number have no amount or unit', () => {
    const result = parseShoppingListEntry('milk');
    expect(result.amount).toBeUndefined();
    expect(result.unit).toBeUndefined();
  });

  it('strips leading "of" from the remainder when unit is attached', () => {
    expect(parseShoppingListEntry('8rashers of bacon')).toEqual({
      amount: 8,
      unit: 'rashers',
      name: 'bacon',
      context: '',
    });
    expect(parseShoppingListEntry('500g of flour')).toEqual({
      amount: 500,
      unit: 'g',
      name: 'flour',
      context: '',
    });
  });

  it('strips leading "of" from the remainder when unit is space-separated', () => {
    expect(parseShoppingListEntry('2 kg of potatoes')).toEqual({
      amount: 2,
      unit: 'kg',
      name: 'potatoes',
      context: '',
    });
  });

  it('strips leading "of" from bare-count remainder', () => {
    expect(parseShoppingListEntry('3 of onions')).toEqual({
      amount: 3,
      name: 'onions',
      context: '',
    });
  });

  it('strips leading "of" from container-unit remainder', () => {
    expect(parseShoppingListEntry('2 bags of crisps')).toEqual({
      amount: 2,
      unit: 'bags',
      name: 'crisps',
      context: '',
    });
  });
});
