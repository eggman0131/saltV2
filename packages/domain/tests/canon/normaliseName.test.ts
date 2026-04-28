import { describe, it, expect } from 'vitest';
import { normaliseName } from '../../src/canon/queries/normaliseName.js';

describe('normaliseName', () => {
  it('lowercases and trims', () => {
    expect(normaliseName('  TOMATO  ')).toBe('tomato');
  });

  it('strips combining diacritical marks', () => {
    expect(normaliseName('Jalapeño')).toBe('jalapeno');
    expect(normaliseName('résumé')).toBe('resume');
    expect(normaliseName('naïve')).toBe('naive');
  });

  it('converts hyphens to spaces', () => {
    expect(normaliseName('free-range')).toBe('free range');
    expect(normaliseName('free-range eggs')).toBe('free range egg');
  });

  it('removes punctuation', () => {
    expect(normaliseName("it's")).toBe('its'); // apostrophe removed; 'its' is 3 chars, not singularized
    expect(normaliseName('salt, pepper')).toBe('salt pepper');
    expect(normaliseName('e.g.')).toBe('eg');
  });

  it('collapses extra whitespace', () => {
    expect(normaliseName('olive   oil')).toBe('olive oil');
    expect(normaliseName('  lots   of   spaces  ')).toBe('lot of space');
  });

  it('singularizes -ies words', () => {
    expect(normaliseName('berries')).toBe('berry');
    expect(normaliseName('cherries')).toBe('cherry');
  });

  it('singularizes -oes words', () => {
    expect(normaliseName('tomatoes')).toBe('tomato');
    expect(normaliseName('potatoes')).toBe('potato');
    expect(normaliseName('mangoes')).toBe('mango');
  });

  it('singularizes regular plurals', () => {
    expect(normaliseName('apples')).toBe('apple');
    expect(normaliseName('carrots')).toBe('carrot');
    expect(normaliseName('grapes')).toBe('grape');
    expect(normaliseName('olives')).toBe('olive');
    expect(normaliseName('eggs')).toBe('egg');
    expect(normaliseName('peas')).toBe('pea');
  });

  it('does not singularize -ss words', () => {
    expect(normaliseName('grass')).toBe('grass');
  });

  it('does not singularize short words (≤3 chars)', () => {
    expect(normaliseName('oil')).toBe('oil');
    expect(normaliseName('rum')).toBe('rum');
  });

  it('returns empty string for blank input', () => {
    expect(normaliseName('')).toBe('');
    expect(normaliseName('   ')).toBe('');
    expect(normaliseName('...')).toBe('');
  });

  it('preserves multi-word names', () => {
    expect(normaliseName('olive oil')).toBe('olive oil');
    expect(normaliseName('Olive Oil')).toBe('olive oil');
  });
});
