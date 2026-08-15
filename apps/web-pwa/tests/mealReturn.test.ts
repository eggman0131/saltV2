import { describe, it, expect } from 'vitest';
import { readMealParam, withMealParam } from '../src/lib/mealReturn.js';

// Where a create flow goes when it finishes (issue #752, Phase 3).
//
// The whole mechanism is two pure string functions, because the return target
// lives in the URL and nowhere else — no module stash, no store, no browser
// storage. What is worth pinning here is therefore exactly what the URL has to
// guarantee: that anything `withMealParam` writes, `readMealParam` reads back,
// including on a path that already carries a querystring, and that the two of
// them agree on what "no meal" looks like.

describe('readMealParam', () => {
  it('reads the meal id off a querystring', () => {
    expect(readMealParam('meal=roast')).toBe('roast');
  });

  it('finds it among other parameters, in any position', () => {
    expect(readMealParam('kind=cocktail&meal=roast')).toBe('roast');
    expect(readMealParam('meal=roast&kind=cocktail')).toBe('roast');
  });

  it('decodes what withMealParam encoded', () => {
    expect(readMealParam('meal=a%2Fb%20c')).toBe('a/b c');
  });

  it('answers null when there is no querystring at all', () => {
    // `router.querystring` is `undefined` on a route with no `?` — the ordinary
    // case for every page in the app, so it must not be a special one here.
    expect(readMealParam(undefined)).toBeNull();
    expect(readMealParam('')).toBeNull();
  });

  it('answers null for other parameters', () => {
    expect(readMealParam('kind=cocktail')).toBeNull();
  });

  it('treats an empty or blank value as no meal', () => {
    // A URL is user input: `?meal=` typed by hand must behave exactly like no
    // parameter, rather than sending the save path after a meal id of ''.
    expect(readMealParam('meal=')).toBeNull();
    expect(readMealParam('meal=%20%20')).toBeNull();
  });

  it('trims a padded value rather than carrying the padding into a lookup', () => {
    expect(readMealParam('meal=%20roast%20')).toBe('roast');
  });
});

describe('withMealParam', () => {
  it('appends the meal id to a plain path', () => {
    expect(withMealParam('/recipes/new', 'roast')).toBe('/recipes/new?meal=roast');
  });

  it('leaves the path untouched when there is no meal', () => {
    // Every call site hands over whatever it has, so "no meal" has to be a
    // no-op rather than something the caller must branch around.
    expect(withMealParam('/recipes/new', null)).toBe('/recipes/new');
    expect(withMealParam('/recipes/new', '   ')).toBe('/recipes/new');
  });

  it('joins with & when the path already carries a querystring', () => {
    expect(withMealParam('/recipes/new?kind=cocktail', 'roast')).toBe(
      '/recipes/new?kind=cocktail&meal=roast',
    );
  });

  it('encodes the id on the way in', () => {
    expect(withMealParam('/chat', 'a/b c')).toBe('/chat?meal=a%2Fb%20c');
  });
});

describe('the round trip — what one writes, the other reads', () => {
  // The property the whole phase rests on: the id survives every hop because it
  // survives this. Anything that breaks it strands a saved dish.
  const ids = ['roast', 'a/b c', 'id?with=query', 'id&with=amp', 'ünïcode', '123'];

  for (const id of ids) {
    it(`survives being written into a path and read back: ${id}`, () => {
      const path = withMealParam('/recipes/new', id);
      const querystring = path.slice(path.indexOf('?') + 1);
      expect(readMealParam(querystring)).toBe(id);
    });

    it(`survives it on a path that already had a querystring: ${id}`, () => {
      const path = withMealParam('/recipes/new?kind=cocktail', id);
      const querystring = path.slice(path.indexOf('?') + 1);
      expect(readMealParam(querystring)).toBe(id);
    });
  }

  it('round-trips "no meal" as no querystring', () => {
    const path = withMealParam('/recipes/new', null);
    expect(path.includes('?')).toBe(false);
    expect(readMealParam(undefined)).toBeNull();
  });
});
