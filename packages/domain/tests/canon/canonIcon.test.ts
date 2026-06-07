import { describe, it, expect } from 'vitest';
import { CANON_ICON_HIDDEN, isCanonIconRenderable } from '../../src/canon/queries/canonIcon.js';

describe('canon icon tri-state helpers', () => {
  it('CANON_ICON_HIDDEN is the "hidden" sentinel', () => {
    expect(CANON_ICON_HIDDEN).toBe('hidden');
  });

  describe('isCanonIconRenderable', () => {
    it('returns true for a real https URL', () => {
      expect(
        isCanonIconRenderable('https://storage.googleapis.com/bucket/canon-icons/abc.webp'),
      ).toBe(true);
    });

    it('returns false for null (no icon yet)', () => {
      expect(isCanonIconRenderable(null)).toBe(false);
    });

    it('returns false for the hidden sentinel', () => {
      expect(isCanonIconRenderable(CANON_ICON_HIDDEN)).toBe(false);
      expect(isCanonIconRenderable('hidden')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isCanonIconRenderable('')).toBe(false);
    });
  });
});
