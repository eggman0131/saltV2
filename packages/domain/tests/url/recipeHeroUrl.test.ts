import { describe, it, expect } from 'vitest';
import { appendCacheBuster, recipeHeroUrl } from '../../src/url/index.js';

/**
 * The hero-URL rule, which used to be written out at eight sites (issue #933).
 *
 * The point of these cases is the two things a hand-copied version gets wrong:
 * the NONCE PRECEDENCE (`imageRequestedAt` beats `updatedAt`, and only while it
 * is set), and returning `null` rather than `''` when there is no image — every
 * call site branches on that to decide whether to render an `<img>` at all.
 */
describe('recipeHeroUrl', () => {
  const url = 'https://storage.test/hero.jpg';

  it('busts with imageRequestedAt while a regeneration is outstanding', () => {
    expect(recipeHeroUrl({ image: { url }, imageRequestedAt: 1234, updatedAt: 'T1' })).toBe(
      `${url}?v=1234`,
    );
  });

  it('falls back to updatedAt once imageRequestedAt is cleared', () => {
    // The trigger clears the stamp when the new bytes land, and `updatedAt` has
    // moved by then — so the browser still drops the old image.
    expect(recipeHeroUrl({ image: { url }, updatedAt: 'T2' })).toBe(`${url}?v=T2`);
    expect(recipeHeroUrl({ image: { url }, imageRequestedAt: null, updatedAt: 'T2' })).toBe(
      `${url}?v=T2`,
    );
  });

  it('treats a zero stamp as a real nonce, not as absent', () => {
    // `??` and not `||`: `0` is a legitimate epoch stamp, and `||` would fall
    // through to `updatedAt` for it. This is the row that fails if someone
    // "simplifies" the operator.
    expect(recipeHeroUrl({ image: { url }, imageRequestedAt: 0, updatedAt: 'T3' })).toBe(
      `${url}?v=0`,
    );
  });

  it('joins with & when the url already carries a query', () => {
    const signed = 'https://storage.test/hero.jpg?alt=media&token=abc';
    expect(recipeHeroUrl({ image: { url: signed }, updatedAt: 'T4' })).toBe(`${signed}&v=T4`);
  });

  it.each([
    { name: 'no image key at all', recipe: { updatedAt: 'T5' } },
    { name: 'an explicitly null image', recipe: { image: null, updatedAt: 'T5' } },
    { name: 'an image with an empty url', recipe: { image: { url: '' }, updatedAt: 'T5' } },
  ])('$name renders nothing — null, never an empty string', ({ recipe }) => {
    expect(recipeHeroUrl(recipe)).toBeNull();
  });

  it('is exactly appendCacheBuster with that precedence, and nothing more', () => {
    // Pins the composition rather than restating the encoding, so a change to
    // how the nonce is appended moves both this and `appendCacheBuster`'s own
    // suite together instead of leaving this one asserting a stale format.
    const recipe = { image: { url }, imageRequestedAt: 99, updatedAt: 'T6' };
    expect(recipeHeroUrl(recipe)).toBe(appendCacheBuster(url, 99));
    expect(recipeHeroUrl({ image: { url }, updatedAt: 'T6' })).toBe(appendCacheBuster(url, 'T6'));
  });
});
